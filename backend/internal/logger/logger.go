package logger

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
	LevelFatal
)

var (
	ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)
)

func stripANSI(s string) string {
	return ansiRegex.ReplaceAllString(s, "")
}

func visibleLen(s string) int {
	return len([]rune(stripANSI(s)))
}

// ANSI Color definitions
const (
	colorReset     = "\033[0m"
	colorDim       = "\033[90m" // Gray / dim
	colorCyan      = "\033[36m" // Info cyan
	colorYellow    = "\033[33m" // Warn yellow
	colorRed       = "\033[31m" // Error red
	colorBoldRed   = "\033[1;31m"
	colorMagenta   = "\033[35m"       // Debug magenta
	colorPurple    = "\033[38;5;141m" // Light purple/lavender (Banner title & stats)
	colorLightBlue = "\033[38;5;147m" // Lavender-blue (Banner version)
	colorWhite     = "\033[97m"       // Bright white (Banner URL)
)

type Logger struct {
	mu       sync.Mutex
	out      io.Writer
	level    Level
	useColor bool
}

var defaultLogger = &Logger{
	out:      os.Stdout,
	level:    LevelDebug,
	useColor: checkColorSupport(),
}

func checkColorSupport() bool {
	if os.Getenv("NO_COLOR") != "" || os.Getenv("TERM") == "dumb" {
		return false
	}
	return true
}

func SetOutput(w io.Writer) {
	defaultLogger.mu.Lock()
	defer defaultLogger.mu.Unlock()
	defaultLogger.out = w
}

func SetLevel(lvl Level) {
	defaultLogger.mu.Lock()
	defer defaultLogger.mu.Unlock()
	defaultLogger.level = lvl
}

func Writer() io.Writer {
	defaultLogger.mu.Lock()
	defer defaultLogger.mu.Unlock()
	return defaultLogger.out
}

func (l *Logger) log(lvl Level, msg string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if lvl < l.level {
		return
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	var levelTag string

	if l.useColor {
		timeTag := fmt.Sprintf("%s[%s]%s", colorDim, now, colorReset)
		switch lvl {
		case LevelDebug:
			levelTag = fmt.Sprintf("%sDEBUG%s ", colorMagenta, colorReset)
		case LevelInfo:
			levelTag = fmt.Sprintf("%sINFO%s  ", colorCyan, colorReset)
		case LevelWarn:
			levelTag = fmt.Sprintf("%sWARN%s  ", colorYellow, colorReset)
		case LevelError:
			levelTag = fmt.Sprintf("%sERROR%s ", colorRed, colorReset)
		case LevelFatal:
			levelTag = fmt.Sprintf("%sFATAL%s ", colorBoldRed, colorReset)
		}
		fmt.Fprintf(l.out, "%s %s%s\n", timeTag, levelTag, msg)
	} else {
		switch lvl {
		case LevelDebug:
			levelTag = "DEBUG "
		case LevelInfo:
			levelTag = "INFO  "
		case LevelWarn:
			levelTag = "WARN  "
		case LevelError:
			levelTag = "ERROR "
		case LevelFatal:
			levelTag = "FATAL "
		}
		fmt.Fprintf(l.out, "[%s] %s%s\n", now, levelTag, msg)
	}

	if lvl == LevelFatal {
		os.Exit(1)
	}
}

func Info(args ...any) {
	defaultLogger.log(LevelInfo, fmt.Sprint(args...))
}

func Infof(format string, args ...any) {
	defaultLogger.log(LevelInfo, fmt.Sprintf(format, args...))
}

func Warn(args ...any) {
	defaultLogger.log(LevelWarn, fmt.Sprint(args...))
}

func Warnf(format string, args ...any) {
	defaultLogger.log(LevelWarn, fmt.Sprintf(format, args...))
}

func Error(args ...any) {
	defaultLogger.log(LevelError, fmt.Sprint(args...))
}

func Errorf(format string, args ...any) {
	defaultLogger.log(LevelError, fmt.Sprintf(format, args...))
}

func Fatal(args ...any) {
	defaultLogger.log(LevelFatal, fmt.Sprint(args...))
}

func Fatalf(format string, args ...any) {
	defaultLogger.log(LevelFatal, fmt.Sprintf(format, args...))
}

func Debug(args ...any) {
	defaultLogger.log(LevelDebug, fmt.Sprint(args...))
}

func Debugf(format string, args ...any) {
	defaultLogger.log(LevelDebug, fmt.Sprintf(format, args...))
}

// Print and Printf aliases for standard logging compatibility
func Print(args ...any) {
	Info(args...)
}

func Printf(format string, args ...any) {
	Infof(format, args...)
}

func Println(args ...any) {
	Info(args...)
}

// stdLogWriter redirects standard library log calls through this formatted logger.
type stdLogWriter struct{}

func (w *stdLogWriter) Write(p []byte) (n int, err error) {
	msg := strings.TrimSpace(string(p))
	if msg == "" {
		return len(p), nil
	}

	// Detect level from common prefixes
	upper := strings.ToUpper(msg)
	switch {
	case strings.HasPrefix(upper, "FATAL:") || strings.HasPrefix(upper, "FATAL "):
		clean := strings.TrimSpace(msg[6:])
		defaultLogger.log(LevelFatal, clean)
	case strings.HasPrefix(upper, "ERROR:") || strings.HasPrefix(upper, "ERROR "):
		clean := strings.TrimSpace(msg[6:])
		defaultLogger.log(LevelError, clean)
	case strings.HasPrefix(upper, "WARNING:") || strings.HasPrefix(upper, "WARN:"):
		idx := strings.Index(msg, ":")
		clean := strings.TrimSpace(msg[idx+1:])
		defaultLogger.log(LevelWarn, clean)
	case strings.HasPrefix(upper, "DEBUG:") || strings.HasPrefix(upper, "DEBUG "):
		clean := strings.TrimSpace(msg[6:])
		defaultLogger.log(LevelDebug, clean)
	default:
		defaultLogger.log(LevelInfo, msg)
	}
	return len(p), nil
}

func init() {
	// Redirect stdlib log output through our logger and clear standard log flags
	log.SetFlags(0)
	log.SetOutput(&stdLogWriter{})
}

// ── Startup Box Banner ────────────────────────────────────────────────────────

type BannerConfig struct {
	AppName   string
	Version   string
	Host      string
	Port      int
	BoundHost string
	BoundPort int
	Handlers  int
	Processes int
	Prefork   string
	PID       int
}

// PrintBanner prints a terminal banner box matching the Fiber style.
func PrintBanner(cfg BannerConfig) {
	if cfg.AppName == "" {
		cfg.AppName = "Cove Server"
	}
	if cfg.Version == "" {
		cfg.Version = "Cove v0.9.0"
	}
	if cfg.Host == "" {
		cfg.Host = "127.0.0.1"
	}
	if cfg.Port == 0 {
		cfg.Port = 4000
	}
	if cfg.BoundHost == "" {
		cfg.BoundHost = "0.0.0.0"
	}
	if cfg.BoundPort == 0 {
		cfg.BoundPort = cfg.Port
	}
	if cfg.Processes == 0 {
		cfg.Processes = 1
	}
	if cfg.Prefork == "" {
		cfg.Prefork = "Disabled"
	}
	if cfg.PID == 0 {
		cfg.PID = os.Getpid()
	}

	const innerWidth = 50

	centerLine := func(text string, colorCode string) string {
		clean := stripANSI(text)
		vLen := len([]rune(clean))
		if vLen >= innerWidth {
			if defaultLogger.useColor && colorCode != "" {
				return colorCode + text + colorReset
			}
			return text
		}
		leftPad := (innerWidth - vLen) / 2
		rightPad := innerWidth - vLen - leftPad
		colored := text
		if defaultLogger.useColor && colorCode != "" {
			colored = colorCode + text + colorReset
		}
		return strings.Repeat(" ", leftPad) + colored + strings.Repeat(" ", rightPad)
	}

	formatLeader := func(label string, dotsLen int, val string) string {
		dots := strings.Repeat(".", dotsLen)
		if defaultLogger.useColor {
			return fmt.Sprintf("%s%s %s%s %s%s%s", colorDim, label, dots, colorReset, colorPurple, val, colorReset)
		}
		return fmt.Sprintf("%s %s %s", label, dots, val)
	}

	// Calculate dot leaders for the 2 columns inside innerWidth (50)
	// Structure: " " (1) + Col 1 (24) + "  " (2) + Col 2 (22) + " " (1) = 50
	handlersVal := fmt.Sprintf("%d", cfg.Handlers)
	dotsH := 24 - (len("Handlers") + 2 + len(handlersVal))
	if dotsH < 1 {
		dotsH = 1
	}
	col1_1 := formatLeader("Handlers", dotsH, handlersVal)

	procVal := fmt.Sprintf("%d", cfg.Processes)
	dotsP := 22 - (len("Processes") + 2 + len(procVal))
	if dotsP < 1 {
		dotsP = 1
	}
	col2_1 := formatLeader("Processes", dotsP, procVal)

	dotsPrefork := 24 - (len("Prefork") + 2 + len(cfg.Prefork))
	if dotsPrefork < 1 {
		dotsPrefork = 1
	}
	col1_2 := formatLeader("Prefork", dotsPrefork, cfg.Prefork)

	pidVal := fmt.Sprintf("%d", cfg.PID)
	dotsPID := 22 - (len("PID") + 2 + len(pidVal))
	if dotsPID < 1 {
		dotsPID = 1
	}
	col2_2 := formatLeader("PID", dotsPID, pidVal)

	topBorder := "┌" + strings.Repeat("─", innerWidth) + "┐"
	bottomBorder := "└" + strings.Repeat("─", innerWidth) + "┘"
	emptyLine := "│" + strings.Repeat(" ", innerWidth) + "│"

	if defaultLogger.useColor {
		topBorder = colorDim + topBorder + colorReset
		bottomBorder = colorDim + bottomBorder + colorReset
		emptyLine = colorDim + "│" + colorReset + strings.Repeat(" ", innerWidth) + colorDim + "│" + colorReset
	}

	borderWrap := func(content string) string {
		if defaultLogger.useColor {
			return colorDim + "│" + colorReset + content + colorDim + "│" + colorReset
		}
		return "│" + content + "│"
	}

	urlStr := fmt.Sprintf("http://%s:%d", cfg.Host, cfg.Port)
	boundStr := fmt.Sprintf("(bound on host %s and port %d)", cfg.BoundHost, cfg.BoundPort)

	padRow := func(leftCol, rightCol string) string {
		line := " " + leftCol + "  " + rightCol
		vLen := visibleLen(line)
		if vLen < innerWidth {
			line += strings.Repeat(" ", innerWidth-vLen)
		}
		return line
	}

	var buf bytes.Buffer
	buf.WriteString("\n")
	buf.WriteString(" " + topBorder + "\n")
	buf.WriteString(" " + borderWrap(centerLine(cfg.AppName, colorPurple)) + "\n")
	buf.WriteString(" " + borderWrap(centerLine(cfg.Version, colorLightBlue)) + "\n")
	buf.WriteString(" " + borderWrap(centerLine(urlStr, colorWhite)) + "\n")
	buf.WriteString(" " + borderWrap(centerLine(boundStr, colorDim)) + "\n")
	buf.WriteString(" " + emptyLine + "\n")
	buf.WriteString(" " + borderWrap(padRow(col1_1, col2_1)) + "\n")
	buf.WriteString(" " + borderWrap(padRow(col1_2, col2_2)) + "\n")
	buf.WriteString(" " + bottomBorder + "\n\n")

	defaultLogger.mu.Lock()
	defer defaultLogger.mu.Unlock()
	_, _ = defaultLogger.out.Write(buf.Bytes())
}
