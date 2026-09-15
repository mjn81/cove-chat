package logger

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

func TestLoggerFormat(t *testing.T) {
	var buf bytes.Buffer
	SetOutput(&buf)
	defaultLogger.useColor = false

	Info("Processing task: dashboard:refresh")

	output := buf.String()
	// Format expected: [YYYY-MM-DD HH:MM:SS] INFO  Processing task: dashboard:refresh
	if !strings.Contains(output, "INFO  Processing task: dashboard:refresh") {
		t.Errorf("Unexpected log output: %q", output)
	}
	if !strings.HasPrefix(output, "[20") {
		t.Errorf("Output should have timestamp in brackets: %q", output)
	}
}

func TestStdLogRedirection(t *testing.T) {
	var buf bytes.Buffer
	SetOutput(&buf)
	defaultLogger.useColor = false

	log.Printf("Hello from stdlib log")
	output := buf.String()

	if !strings.Contains(output, "INFO  Hello from stdlib log") {
		t.Errorf("Stdlib redirection failed, got: %q", output)
	}
}

func TestPrintBanner(t *testing.T) {
	var buf bytes.Buffer
	SetOutput(&buf)
	defaultLogger.useColor = false

	PrintBanner(BannerConfig{
		AppName:   "NodeTalk Server",
		Version:   "NodeTalk v0.9.0",
		Host:      "127.0.0.1",
		Port:      4000,
		BoundHost: "0.0.0.0",
		BoundPort: 4000,
		Handlers:  23,
		Processes: 1,
		Prefork:   "Disabled",
		PID:       12345,
	})

	output := buf.String()
	if !strings.Contains(output, "┌") || !strings.Contains(output, "┘") {
		t.Errorf("Banner missing border: %q", output)
	}
	if !strings.Contains(output, "NodeTalk Server") {
		t.Errorf("Banner missing app name: %q", output)
	}
	if !strings.Contains(output, "http://127.0.0.1:4000") {
		t.Errorf("Banner missing URL: %q", output)
	}
	if !strings.Contains(output, "Handlers") || !strings.Contains(output, "23") {
		t.Errorf("Banner missing handlers: %q", output)
	}
	if !strings.Contains(output, "PID") || !strings.Contains(output, "12345") {
		t.Errorf("Banner missing PID: %q", output)
	}
}
