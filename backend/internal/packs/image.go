package packs

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// Errors of image validation. ErrUnsupported and ErrDimensions are the uploader's mistake (400); ErrTooLarge means the
// bytes are over the cap (413).
var (
	ErrUnsupported = errors.New("packs: not a supported image")
	ErrDimensions  = errors.New("packs: image dimensions are not allowed")
	ErrTooLarge    = errors.New("packs: image is too large")
)

// Info describes a validated raster image.
type Info struct {
	Format   string // "png" | "jpeg" | "gif" | "webp"
	MIME     string
	Width    int
	Height   int
	Animated bool
}

// ImageLimits bound what a pack image may be after normalisation.
type ImageLimits struct {
	MaxBytes int   // size cap of the stored image
	MaxDim   int   // longest allowed side of the stored image
	Formats  []string // accepted source formats
}

const (
	// maxSourceDim guards the decoder: nothing larger than this is ever handed to ffmpeg or the image package, so a
	// tiny file that declares a huge canvas (a decompression bomb) is refused up front.
	maxSourceDim = 4096
	// normalizeTimeout bounds one ffmpeg run.
	normalizeTimeout = 30 * time.Second
	// maxAnimationSeconds caps how much of an animation is kept.
	maxAnimationSeconds = 10
)

// Inspect identifies an image by its magic bytes and reads its size without decoding the pixels. SVG, HTML and every
// other format are refused here; the claimed content type of the upload is never consulted.
func Inspect(data []byte) (Info, error) {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		cfg, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return Info{}, ErrUnsupported
		}
		return Info{Format: "png", MIME: "image/png", Width: cfg.Width, Height: cfg.Height, Animated: bytes.Contains(data[:min(len(data), 4096)], []byte("acTL"))}, nil
	case bytes.HasPrefix(data, []byte("GIF87a")), bytes.HasPrefix(data, []byte("GIF89a")):
		cfg, err := gif.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return Info{}, ErrUnsupported
		}
		// A graphic control extension (21 F9 04) precedes each frame; two or more means an animation.
		return Info{Format: "gif", MIME: "image/gif", Width: cfg.Width, Height: cfg.Height, Animated: bytes.Count(data, []byte{0x21, 0xF9, 0x04}) > 1}, nil
	case len(data) > 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return Info{}, ErrUnsupported
		}
		return Info{Format: "jpeg", MIME: "image/jpeg", Width: cfg.Width, Height: cfg.Height}, nil
	case len(data) >= 30 && bytes.Equal(data[0:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return inspectWebP(data)
	}
	return Info{}, ErrUnsupported
}

// inspectWebP reads the canvas size and the animation flag from the first chunk of a WebP file.
func inspectWebP(data []byte) (Info, error) {
	info := Info{Format: "webp", MIME: "image/webp"}
	switch string(data[12:16]) {
	case "VP8 ": // lossy: frame tag (3 bytes), start code 9d 01 2a, then 14-bit width and height
		if len(data) < 30 || data[23] != 0x9d || data[24] != 0x01 || data[25] != 0x2a {
			return Info{}, ErrUnsupported
		}
		info.Width = int(binary.LittleEndian.Uint16(data[26:28]) & 0x3fff)
		info.Height = int(binary.LittleEndian.Uint16(data[28:30]) & 0x3fff)
	case "VP8L": // lossless: signature 0x2f, then 14-bit width-1 and height-1
		if data[20] != 0x2f {
			return Info{}, ErrUnsupported
		}
		bits := binary.LittleEndian.Uint32(data[21:25])
		info.Width = int(bits&0x3fff) + 1
		info.Height = int((bits>>14)&0x3fff) + 1
	case "VP8X": // extended: flags, then 24-bit canvas width-1 and height-1
		info.Animated = data[20]&0x02 != 0
		info.Width = int(uint32(data[24])|uint32(data[25])<<8|uint32(data[26])<<16) + 1
		info.Height = int(uint32(data[27])|uint32(data[28])<<8|uint32(data[29])<<16) + 1
	default:
		return Info{}, ErrUnsupported
	}
	if info.Width <= 0 || info.Height <= 0 {
		return Info{}, ErrUnsupported
	}
	return info, nil
}

func (l ImageLimits) allows(format string) bool {
	for _, f := range l.Formats {
		if f == format {
			return true
		}
	}
	return false
}

// Normalize validates an upload and brings it within the limits. With ffmpeg (ffmpegPath resolves) every accepted
// image is re-encoded as WebP no larger than MaxDim, which strips metadata and bounds the size; animations stay
// animated (at most ten seconds). Without ffmpeg, or when it cannot read the file (for example an animated WebP),
// the strict fallback accepts the original bytes only if they already fit the limits.
func Normalize(ctx context.Context, ffmpegPath string, data []byte, lim ImageLimits) ([]byte, Info, error) {
	info, err := Inspect(data)
	if err != nil || !lim.allows(info.Format) {
		return nil, Info{}, ErrUnsupported
	}
	if info.Width > maxSourceDim || info.Height > maxSourceDim {
		return nil, Info{}, ErrDimensions
	}

	if out, outInfo, ok := reencode(ctx, ffmpegPath, data, info, lim); ok {
		return out, outInfo, nil
	}

	if info.Width > lim.MaxDim || info.Height > lim.MaxDim {
		return nil, Info{}, ErrDimensions
	}
	if len(data) > lim.MaxBytes {
		return nil, Info{}, ErrTooLarge
	}
	return data, info, nil
}

// reencode runs ffmpeg and reports whether it produced an image within the limits.
func reencode(ctx context.Context, ffmpegPath string, data []byte, info Info, lim ImageLimits) ([]byte, Info, bool) {
	bin, err := exec.LookPath(ffmpegBinary(ffmpegPath))
	if err != nil {
		return nil, Info{}, false
	}
	dir, err := os.MkdirTemp("", "cove-pack-*")
	if err != nil {
		return nil, Info{}, false
	}
	defer func() { _ = os.RemoveAll(dir) }()
	in := filepath.Join(dir, "in")
	out := filepath.Join(dir, "out.webp")
	if err := os.WriteFile(in, data, 0o600); err != nil {
		return nil, Info{}, false
	}

	filter := fmt.Sprintf("scale='min(%d,iw)':'min(%d,ih)':force_original_aspect_ratio=decrease:flags=lanczos", lim.MaxDim, lim.MaxDim)
	for _, quality := range []string{"80", "60", "40"} {
		ctx2, cancel := context.WithTimeout(ctx, normalizeTimeout)
		args := []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-t", fmt.Sprint(maxAnimationSeconds), "-i", in, "-vf", filter, "-an"}
		if info.Animated {
			args = append(args, "-c:v", "libwebp_anim", "-loop", "0")
		} else {
			args = append(args, "-frames:v", "1", "-c:v", "libwebp")
		}
		args = append(args, "-quality", quality, "-f", "webp", out)
		err := exec.CommandContext(ctx2, bin, args...).Run()
		cancel()
		if err != nil {
			return nil, Info{}, false
		}
		res, err := os.ReadFile(out)
		if err != nil {
			return nil, Info{}, false
		}
		outInfo, err := Inspect(res)
		if err != nil || outInfo.Width > lim.MaxDim || outInfo.Height > lim.MaxDim {
			return nil, Info{}, false
		}
		if len(res) <= lim.MaxBytes {
			return res, outInfo, true
		}
	}
	return nil, Info{}, false
}

func ffmpegBinary(configured string) string {
	if configured == "" {
		return "ffmpeg"
	}
	return configured
}
