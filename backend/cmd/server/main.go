// Cove API
//
//	@title          Cove API
//	@version        0.1.0
//	@description    Self-hosted, end-to-end encrypted communication platform.
//	@termsOfService http://nodetalk.local/terms
//
//	@contact.name  Cove Support
//	@contact.url   https://github.com/nodetalk/backend/nodetalk
//
//	@license.name MIT
//	@license.url  https://opensource.org/licenses/MIT
//
//	@host		localhost:4000
//	@BasePath /
//
//	@securityDefinitions.apikey BearerAuth
//	@in                         header
//	@name                       Authorization
//	@description               Format: Bearer <token>

package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "nodetalk/backend/docs" // Swagger generated docs — run 'swag init' to regenerate

	httpSwagger "github.com/swaggo/http-swagger"
	"nodetalk/backend/internal/api"
	"nodetalk/backend/internal/auth"
	"nodetalk/backend/internal/config"
	"nodetalk/backend/internal/crypto"
	"nodetalk/backend/internal/db"
	"nodetalk/backend/internal/logger"
	"nodetalk/backend/internal/middleware"
	"nodetalk/backend/internal/models"
	"nodetalk/backend/internal/rtc"
	"nodetalk/backend/internal/storage"
	"nodetalk/backend/internal/store"
	"nodetalk/backend/internal/voice"
	"nodetalk/backend/internal/ws"
)

func main() {
	// ── 1. Load config ────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		logger.Fatalf("Config load failed: %v", err)
	}
	middleware.TrustProxyHeaders = cfg.Server.TrustProxyHeaders

	// ── 2. Derive KEK ─────────────────────────────────────────────────────
	kek := crypto.DeriveKEK(cfg.Security.MasterPassword)

	// ── 3. Bootstrap DEK ──────────────────────────────────────────────────
	metaPath := cfg.Database.Path + "/meta"
	dek, err := db.BootstrapDEK(metaPath, kek)
	if err != nil {
		logger.Fatalf("DEK bootstrap failed: %v", err)
	}

	// ── 4. Open BadgerDB ──────────────────────────────────────────────────
	mainPath := cfg.Database.Path + "/main"
	database, err := db.Open(mainPath, dek)
	if err != nil {
		logger.Fatalf("Database open failed: %v", err)
	}
	defer func() {
		_ = database.Close()
	}()

	stopGC := make(chan struct{})
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-stopGC:
				return
			case <-t.C:
				_ = database.RunGC()
			}
		}
	}()

	// ── 5. App layers ──────────────────────────────────────────────────────
	dataStore := store.New(database)

	// "server restore <file>" loads an admin-panel backup into an empty
	// database and exits. The archive passphrase comes from the environment so
	// it never lands in shell history or the process list.
	if len(os.Args) >= 3 && os.Args[1] == "restore" {
		os.Exit(runRestore(dataStore, os.Args[2], len(os.Args) > 3 && os.Args[3] == "--force"))
	}
	tokenTTL  := time.Duration(cfg.Security.TokenExpireHours) * time.Hour
	sessions  := auth.NewSessionStore(tokenTTL, database)

	// Registration invites declared in config.toml are mirrored into the DB,
	// and a configured owner_username can reclaim ownership (lost-login recovery).
	var inviteSpecs []models.InviteSpec
	for _, inv := range cfg.Registration.Invites {
		spec := models.InviteSpec{Code: inv.Code, Note: inv.Note, MaxUses: inv.MaxUses}
		if inv.ExpiresAt != "" {
			if t, perr := time.Parse(time.RFC3339, inv.ExpiresAt); perr == nil {
				spec.ExpiresAt = &t
			}
		}
		inviteSpecs = append(inviteSpecs, spec)
	}
	if err := dataStore.SeedConfigInvites(inviteSpecs); err != nil {
		logger.Warnf("registration: could not sync config invites: %v", err)
	}
	if cfg.Admin.OwnerUsername != "" {
		if err := dataStore.RecoverOwner(cfg.Admin.OwnerUsername); err != nil {
			logger.Warnf("admin: owner_username recovery failed: %v", err)
		}
	}

	// ── 6. HTTP router + WebSocket Hub ────────────────────────────────────
	var blobStorage storage.BlobStorage
	if cfg.Storage.S3 != nil && cfg.Storage.S3.Enabled {
		// TODO: Implement S3Storage
		logger.Warn("ws: S3 storage requested but not yet implemented, falling back to FileSystem")
		blobStorage = &storage.FileSystemStorage{BaseDir: cfg.Storage.UploadDir}
	} else {
		blobStorage = &storage.FileSystemStorage{BaseDir: cfg.Storage.UploadDir}
	}

	// Buffered: the admin "delete server" action sends SIGTERM here too.
	quit := make(chan os.Signal, 2)

	apiHandler := &api.Handler{
		Store:          dataStore,
		Sessions:       sessions,
		KEK:            kek,
		Storage:        blobStorage,
		TokenTTL:            tokenTTL,
		MaxFileSizeMB:       cfg.Server.MaxFileSizeMB,
		MaxVideoSizeMB:      cfg.Server.MaxVideoSizeMB,
		MaxVideoDurationSec: cfg.Server.MaxVideoDurationSec,
		FFmpegPath:          cfg.Server.FFmpegPath,
		UDPPort:             cfg.Server.UDPPort,
		IsDev:               cfg.Server.Dev,
		FrontendOrigin:      cfg.Server.FrontendOrigin,
		Settings: api.NewSettings(api.SettingsInit{
			RegistrationMode:    cfg.Registration.Mode,
			MaxFileSizeMB:       cfg.Server.MaxFileSizeMB,
			MaxVideoSizeMB:      cfg.Server.MaxVideoSizeMB,
			MaxVideoDurationSec: cfg.Server.MaxVideoDurationSec,
		}),
		ConfigPath:   config.Path(),
		DataDir:      cfg.Database.Path,
		ServerDomain: cfg.Server.Domain,
		StartedAt:    time.Now(),
		Shutdown:     func() { quit <- syscall.SIGTERM },
	}
	hub := ws.NewHub(dataStore, sessions, kek, cfg.Server.Dev, cfg.Server.FrontendOrigin)
	apiHandler.Hub = hub

	rootMux := http.NewServeMux()
	rootMux.Handle("/ws", hub)
	// Swagger UI — available at /api/docs/ only in dev mode
	if cfg.Server.Dev {
		rootMux.Handle("/api/docs/", httpSwagger.WrapHandler)
	}
	rootMux.Handle("/", api.NewRouter(apiHandler, float64(cfg.RateLimit.GlobalRPS), float64(cfg.RateLimit.AuthRPS)))

	// ── 7. HTTP server ─────────────────────────────────────────────────────
	addr := fmt.Sprintf(":%d", cfg.Server.HTTPPort)
	srv := &http.Server{
		Addr:         addr,
		Handler:      middleware.Recover(middleware.Logger(rootMux)),
		ReadTimeout:  1 * time.Hour,
		WriteTimeout: 1 * time.Hour,
		IdleTimeout:  120 * time.Second,
	}

	// ── 8. UDP voice router ────────────────────────────────────────────────
	// Independent of Voice.Mode: this is the legacy audio-only fallback,
	// left running whenever a UDP port is configured regardless of which
	// engine group calls use, since desktop clients may still target it.
	var udpConn *net.UDPConn
	if cfg.Server.UDPPort > 0 {
		voiceRouter := voice.NewRouter(sessions, hub, dataStore)
		hub.SetVoiceRouter(voiceRouter)
		var err error
		udpConn, err = startUDPRouter(cfg.Server.UDPPort, voiceRouter)
		if err != nil {
			logger.Warnf("UDP voice router failed to start: %v", err)
		}
	}

	// ── 8b. WebRTC group calling (SFU) ─────────────────────────────────────
	// See internal/rtc for the full design. Only constructed in "webrtc"
	// mode — "raw_udp" mode deployments (isolated/LAN networks) use only the
	// router above and never touch this package at all.
	var rtcManager *rtc.Manager
	if cfg.Voice.Mode == "webrtc" {
		resolvedPublicIP := cfg.Voice.PublicIP
		if resolvedPublicIP == "auto" {
			ip, discoverErr := rtc.DiscoverPublicIP(cfg.Voice.PublicIPDiscoverySTUNServers, 5*time.Second)
			if discoverErr != nil {
				logger.Warnf("voice.public_ip=auto but discovery failed (%v) — continuing without a public IP (no NAT traversal)", discoverErr)
				resolvedPublicIP = ""
			} else {
				logger.Infof("voice: auto-detected public IP %s via STUN", ip)
				resolvedPublicIP = ip
			}
		}

		rtcManager, err = rtc.NewManager(rtc.Config{
			Mode:                   rtc.ModeWebRTC,
			MaxParticipantsPerCall: cfg.Voice.MaxParticipantsPerCall,
			PortMin:                uint16(cfg.Voice.WebRTCPortMin),
			PortMax:                uint16(cfg.Voice.WebRTCPortMax),
			PublicIP:               resolvedPublicIP,
			EmbeddedTURNEnabled:    cfg.Voice.EmbeddedTURNEnabled,
			TURNPort:               cfg.Voice.EmbeddedTURNPort,
			TURNRealm:              cfg.Voice.TURNRealm,
			TURNSharedSecret:       cfg.Voice.TURNSharedSecret,
		}, dataStore, hub)
		if err != nil {
			logger.Warnf("WebRTC calling failed to start, disabling group calls: %v", err)
		} else {
			hub.SetRTCManager(rtcManager)
			logger.Infof("WebRTC group calling enabled (max %d participants/call)", cfg.Voice.MaxParticipantsPerCall)
		}
	}

	// ── 9. Graceful shutdown ───────────────────────────────────────────────
	signal.Notify(quit, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	host := cfg.Server.Domain
	if host == "localhost" {
		host = "127.0.0.1"
	}
	logger.PrintBanner(logger.BannerConfig{
		AppName:   "Cove Server",
		Version:   "Cove v0.9.0",
		Host:      host,
		Port:      cfg.Server.HTTPPort,
		BoundHost: "0.0.0.0",
		BoundPort: cfg.Server.HTTPPort,
		Handlers:  23,
		Processes: 1,
		Prefork:   "Disabled",
		PID:       os.Getpid(),
	})

	go func() {
		logger.Infof("HTTP server listening on %s  |  Swagger: http://localhost%s/api/docs/", addr, addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatalf("HTTP server error: %v", err)
		}
	}()

	sig := <-quit
	logger.Infof("Received %v, shutting down gracefully…", sig)

	// In case user presses Ctrl+C again, force immediate exit while ensuring DB lock is released
	go func() {
		<-quit
		logger.Warn("Force shutdown requested, exiting immediately…")
		_ = database.Close()
		os.Exit(1)
	}()

	// 1. Stop background GC ticker
	close(stopGC)

	// 2. Close UDP voice listener immediately (releases UDP port)
	if udpConn != nil {
		_ = udpConn.Close()
	}

	// 2b. Tear down all active WebRTC calls and the embedded TURN server
	if rtcManager != nil {
		rtcManager.Stop()
	}

	// 3. Disconnect WebSocket clients so HTTP server can finish shutdown immediately
	hub.Close()

	// 4. Shutdown HTTP server with 3-second timeout (releases TCP port)
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelShutdown()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Warnf("HTTP server shutdown timed out: %v, forcing close", err)
		_ = srv.Close()
	}

	// 5. Explicitly close BadgerDB to flush data and release directory lock
	if err := database.Close(); err != nil {
		logger.Warnf("Database close error: %v", err)
	}

	logger.Info("Cove stopped.")
}

// startUDPRouter opens a raw UDP socket for desktop voice routing.
// The server routes opaque audio packets — it never decodes them.
func startUDPRouter(port int, router *voice.Router) (*net.UDPConn, error) {
	addr := &net.UDPAddr{Port: port}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		logger.Warnf("UDP router failed on port %d: %v", port, err)
		return nil, err
	}
	logger.Infof("UDP voice router on :%d", port)

	go func() {
		defer conn.Close()
		router.HandleConn(conn)
	}()

	return conn, nil
}

// runRestore implements the restore subcommand and returns the exit code.
func runRestore(dataStore *store.Store, path string, force bool) int {
	pass := os.Getenv("NODETALK_BACKUP_PASSPHRASE")
	if pass == "" {
		logger.Error("restore: set NODETALK_BACKUP_PASSPHRASE to the passphrase chosen when the backup was made")
		return 2
	}
	if dataStore.HasOwner() && !force {
		logger.Error("restore: this database already has data; pass --force to merge the backup into it")
		return 2
	}
	data, err := os.ReadFile(path)
	if err != nil {
		logger.Errorf("restore: cannot read %s: %v", path, err)
		return 1
	}
	plain, err := api.DecryptBackup(data, pass)
	if err != nil {
		logger.Error("restore: wrong passphrase or damaged backup file")
		return 1
	}
	if err := dataStore.Restore(bytes.NewReader(plain)); err != nil {
		logger.Errorf("restore failed: %v", err)
		return 1
	}
	logger.Info("restore complete - start the server normally")
	return 0
}
