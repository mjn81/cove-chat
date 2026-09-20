package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"nodetalk/backend/internal/api"
	"nodetalk/backend/internal/auth"
	"nodetalk/backend/internal/crypto"
	"nodetalk/backend/internal/db"
	"nodetalk/backend/internal/models"
	"nodetalk/backend/internal/storage"
	"nodetalk/backend/internal/store"
	"nodetalk/backend/internal/voice"
	"nodetalk/backend/internal/ws"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"io"
	"log"
)

func TestStressBackend(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping stress test in short mode")
	}

	// 1. Get configuration from environment
	concurrency := getEnvInt("STRESS_CONCURRENCY", 10)
	requestsPerWorker := getEnvInt("STRESS_REQUESTS", 20)
	totalExpected := concurrency * requestsPerWorker

	// Silence internal logs to keep terminal clean for progress bar
	originalLogOutput := log.Writer()
	log.SetOutput(io.Discard)
	defer log.SetOutput(originalLogOutput)

	fmt.Printf("\n>>> STARTING STRESS TEST: %d concurrency, %d requests per worker (Total: %d)\n", concurrency, requestsPerWorker, totalExpected)

	// 2. Setup isolated complex server (REST + WS + UDP)
	srv, udpAddr, cleanup := setupComplexTestServer(t)
	defer cleanup()

	var wg sync.WaitGroup
	results := make(chan time.Duration, totalExpected)
	errors := make(chan error, totalExpected*5) // buffer for multiple errors per flow
	
	var completedCount int64

	start := time.Now()

	// 3. Run workers
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for j := 0; j < requestsPerWorker; j++ {
				flowStart := time.Now()
				username := fmt.Sprintf("stress_%d_%d_%d", workerID, j, time.Now().UnixNano()%1000)
				password := "password123"

				if err := runFullUserFlow(srv, udpAddr, username, password); err != nil {
					errors <- fmt.Errorf("worker %d flow %d failed: %v", workerID, j, err)
				} else {
					results <- time.Since(flowStart)
				}

				newCount := atomic.AddInt64(&completedCount, 1)
				if newCount%5 == 0 || newCount == int64(totalExpected) {
					drawProgressBar(newCount, int64(totalExpected), start)
				}
			}
		}(i)
	}

	wg.Wait()
	fmt.Println() // Move to next line after progress bar finishes
	close(results)
	close(errors)

	duration := time.Since(start)

	// 4. Process results
	var latencies []time.Duration
	for l := range results {
		latencies = append(latencies, l)
	}
	
	errCount := 0
	var lastErr error
	for e := range errors {
		errCount++
		lastErr = e
	}

	sort.Slice(latencies, func(i, j int) bool {
		return latencies[i] < latencies[j]
	})

	// 5. Generate Report
	report := generateStressReport(duration, latencies, errCount, totalExpected)
	if lastErr != nil {
		report += fmt.Sprintf("\nSample Error: %v\n", lastErr)
	}

	// 6. Output to terminal
	fmt.Println(report)

	// 7. Save to file
	timestamp := time.Now().Format("2006-01-02_15-04-05")
	filename := fmt.Sprintf("stress_report_%s.txt", timestamp)
	_ = os.WriteFile(filename, []byte(report), 0644)
	fmt.Printf("Report saved to %s\n", filename)
}

func runFullUserFlow(srv *httptest.Server, udpAddr *net.UDPAddr, username, password string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// A. Register
	regBody := jsonBodyRaw(api.RegisterRequest{Username: username, Password: password})
	resp, err := http.Post(srv.URL+"/api/register", "application/json", regBody)
	if err != nil { return err }
	if resp.StatusCode != http.StatusCreated { 
		resp.Body.Close()
		return fmt.Errorf("register status %d", resp.StatusCode) 
	}
	resp.Body.Close()

	// B. Login
	loginBody := jsonBodyRaw(api.LoginRequest{Username: username, Password: password})
	resp, err = http.Post(srv.URL+"/api/login", "application/json", loginBody)
	if err != nil { return err }
	var loginResp api.LoginResponse
	json.NewDecoder(resp.Body).Decode(&loginResp)
	resp.Body.Close()

	// C. WebSocket Connection
	wsURL := "ws" + srv.URL[4:] + "/ws"
	c, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + loginResp.Token}},
	})
	if err != nil { return fmt.Errorf("ws dial: %v", err) }
	defer c.Close(websocket.StatusNormalClosure, "")

	// D. Send WS Message (optional, but let's just wait for presence)
	var wsMsg models.WSMessage
	if err := wsjson.Read(ctx, c, &wsMsg); err != nil {
		return fmt.Errorf("ws read: %v", err)
	}

	// E. Voice UDP Registration
	udpConn, err := net.DialUDP("udp", nil, udpAddr)
	if err != nil { return fmt.Errorf("udp dial: %v", err) }
	defer udpConn.Close()

	// Packet format: [Type=Register][Token]
	regPkt := append([]byte{voice.PacketTypeRegister}, []byte(loginResp.Token)...)
	_, err = udpConn.Write(regPkt)
	if err != nil { return fmt.Errorf("udp write: %v", err) }

	// API Me call (one more REST)
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+loginResp.Token)
	resp, err = http.DefaultClient.Do(req)
	if err != nil { return err }
	resp.Body.Close()

	return nil
}

func setupComplexTestServer(t *testing.T) (*httptest.Server, *net.UDPAddr, func()) {
	dir := t.TempDir()
	kek := crypto.DeriveKEK("stress-test-master-password")
	dek, _ := db.BootstrapDEK(dir+"/meta", kek)
	database, _ := db.Open(dir+"/main", dek)
	
	dataStore := store.New(database)
	sessions := auth.NewSessionStore(24 * time.Hour)
	hub := ws.NewHub(dataStore, sessions, kek, true, "http://localhost:5173")
	
	handler := &api.Handler{
		Store:         dataStore,
		Sessions:      sessions,
		Hub:           hub,
		KEK:           kek,
		Storage:       &storage.FileSystemStorage{BaseDir: dir + "/uploads"},
		TokenTTL:      24 * time.Hour,
		MaxFileSizeMB: 10,
		IsDev:         true,
	}

	rootMux := http.NewServeMux()
	rootMux.Handle("/ws", hub)
	rootMux.Handle("/", api.NewRouter(handler, 10000, 10000))

	srv := httptest.NewServer(rootMux)

	// UDP Voice
	voiceRouter := voice.NewRouter(sessions, hub, dataStore)
	udpConn, _ := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	udpAddr := udpConn.LocalAddr().(*net.UDPAddr)
	go voiceRouter.HandleConn(udpConn)

	cleanup := func() {
		srv.Close()
		udpConn.Close()
		database.Close()
		os.RemoveAll(dir)
	}

	return srv, udpAddr, cleanup
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func generateStressReport(totalDuration time.Duration, latencies []time.Duration, errCount int, totalExpected int) string {
	successCount := len(latencies)
	rps := float64(successCount) / totalDuration.Seconds()
	
	avg := time.Duration(0)
	p50 := time.Duration(0)
	p95 := time.Duration(0)
	p99 := time.Duration(0)

	if successCount > 0 {
		sum := time.Duration(0)
		for _, l := range latencies {
			sum += l
		}
		avg = sum / time.Duration(successCount)
		p50 = latencies[int(float64(successCount)*0.5)]
		p95 = latencies[int(float64(successCount)*0.95)]
		p99 = latencies[int(float64(successCount)*0.99)]
	}

	return fmt.Sprintf(`
================================================================
                COMPREHENSIVE STRESS TEST REPORT
================================================================
Date: %s
Duration: %v
Planned Flows:          %d
Successful Flows:       %d
Failed Flows:           %d
Success Rate:           %.2f%%

SYSTEMS TESTED:
- REST API (Register, Login, Me)
- WebSocket (Dial, Presence Read)
- Voice UDP (Dial, Registration)

METRICS:
Throughput:             %.2f flows/sec
Average Latency:        %v
P50 Latency:            %v
P95 Latency:            %v
P99 Latency:            %v
================================================================
`, time.Now().Format(time.RFC1123), totalDuration, totalExpected, successCount, errCount, float64(successCount)/float64(totalExpected)*100, rps, avg, p50, p95, p99)
}

func jsonBodyRaw(v any) *bytes.Buffer {
	b, _ := json.Marshal(v)
	return bytes.NewBuffer(b)
}

func drawProgressBar(current, total int64, startTime time.Time) {
	const barWidth = 30
	percent := float64(current) / float64(total)
	filled := int(percent * barWidth)
	
	bar := make([]byte, barWidth)
	for i := 0; i < barWidth; i++ {
		if i < filled {
			bar[i] = '='
		} else if i == filled {
			bar[i] = '>'
		} else {
			bar[i] = '-'
		}
	}
	
	elapsed := time.Since(startTime)
	rps := float64(current) / elapsed.Seconds()
	
	fmt.Printf("\rProgress: [%s] %d/%d (%.1f%%) | %.1f flows/s | %v   ", 
		string(bar), current, total, percent*100, rps, elapsed.Round(time.Second))
}
