// NodeTalk API
//
//	@title          NodeTalk API
//	@version        0.1.0
//	@description    Self-hosted, end-to-end encrypted communication platform.
//	@termsOfService http://nodetalk.local/terms
//
//	@contact.name  NodeTalk Support
//	@contact.url   https://github.com/nodetalk/backend/nodetalk
//
//	@license.name MIT
//	@license.url  https://opensource.org/licenses/MIT
//
//	@host     localhost:8080
//	@BasePath /
//
//	@securityDefinitions.apikey BearerAuth
//	@in                         header
//	@name                       Authorization
//	@description               Format: Bearer <token>

package main

import (
	"context"
	"fmt"
	"log"
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
	"nodetalk/backend/internal/middleware"
	"nodetalk/backend/internal/storage"
	"nodetalk/backend/internal/store"
	"nodetalk/backend/internal/voice"
	"nodetalk/backend/internal/ws"
)

func main() {
	// ── 1. Load config ────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("FATAL: config load failed: %v", err)
	}
	log.Printf("NodeTalk starting on %s:%d", cfg.Server.Domain, cfg.Server.HTTPPort)
	middleware.TrustProxyHeaders = cfg.Server.TrustProxyHeaders

	// ── 2. Derive KEK ─────────────────────────────────────────────────────
	kek := crypto.DeriveKEK(cfg.Security.MasterPassword)

	// ── 3. Bootstrap DEK ──────────────────────────────────────────────────
	metaPath := cfg.Database.Path + "/meta"
	dek, err := db.BootstrapDEK(metaPath, kek)
	if err != nil {
		log.Fatalf("FATAL: DEK bootstrap failed: %v", err)
	}

	// ── 4. Open BadgerDB ──────────────────────────────────────────────────
	mainPath := cfg.Database.Path + "/main"
	database, err := db.Open(mainPath, dek)
	if err != nil {
		log.Fatalf("FATAL: database open failed: %v", err)
	}
	defer func() {
		if err := database.Close(); err != nil {
			log.Printf("WARNING: database close error: %v", err)
		}
	}()

	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for range t.C {
			_ = database.RunGC()
		}
	}()

	// ── 5. App layers ──────────────────────────────────────────────────────
	dataStore := store.New(database)
	tokenTTL  := time.Duration(cfg.Security.TokenExpireHours) * time.Hour
	sessions  := auth.NewSessionStore(tokenTTL)

	// ── 6. HTTP router + WebSocket Hub ────────────────────────────────────
	var blobStorage storage.BlobStorage
	if cfg.Storage.S3 != nil && cfg.Storage.S3.Enabled {
		// TODO: Implement S3Storage
		log.Println("ws: S3 storage requested but not yet implemented, falling back to FileSystem")
		blobStorage = &storage.FileSystemStorage{BaseDir: cfg.Storage.UploadDir}
	} else {
		blobStorage = &storage.FileSystemStorage{BaseDir: cfg.Storage.UploadDir}
	}

	apiHandler := &api.Handler{
		Store:          dataStore,
		Sessions:       sessions,
		KEK:            kek,
		Storage:        blobStorage,
		TokenTTL:       tokenTTL,
		MaxFileSizeMB:  cfg.Server.MaxFileSizeMB,
		UDPPort:        cfg.Server.UDPPort,
		IsDev:          cfg.Server.Dev,
		FrontendOrigin: cfg.Server.FrontendOrigin,
	}
	hub := ws.NewHub(dataStore, sessions, kek)
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
	if cfg.Server.UDPPort > 0 {
		voiceRouter := voice.NewRouter(sessions, hub)
		go startUDPRouter(cfg.Server.UDPPort, voiceRouter)
	}

	// ── 9. Graceful shutdown ───────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("HTTP listening on %s  |  Swagger: http://localhost%s/api/docs/", addr, addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("FATAL: HTTP server error: %v", err)
		}
	}()

	<-quit
	log.Println("Shutting down…")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("HTTP server forced shutdown: %v", err)
	}
	log.Println("NodeTalk stopped.")
}

// startUDPRouter opens a raw UDP socket for desktop voice routing.
// The server routes opaque audio packets — it never decodes them.
func startUDPRouter(port int, router *voice.Router) {
	addr := &net.UDPAddr{Port: port}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		log.Printf("WARNING: UDP router failed on port %d: %v", port, err)
		return
	}
	defer conn.Close()
	log.Printf("UDP voice router on :%d", port)

	router.HandleConn(conn)
}
