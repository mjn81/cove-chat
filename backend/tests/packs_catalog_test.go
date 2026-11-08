package tests

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"

	"cove/backend/internal/config"
	"cove/backend/internal/packs"
)

func TestPacksCatalog_EmbeddedAssetsAreComplete(t *testing.T) {
	cat, err := packs.Builtin()
	if err != nil {
		t.Fatalf("embedded catalog: %v", err)
	}
	ids := map[string]bool{}
	for _, s := range cat.Styles {
		ids[s.ID] = true
		if s.Version == "" || s.SheetBytes < 100<<10 || s.CellSize != 64 || s.Count < 500 || s.License == "" || s.Attribution == "" {
			t.Errorf("style %s looks incomplete: %+v", s.ID, s)
		}
		if f, err := cat.Open(s.SheetPath); err != nil {
			t.Errorf("style %s sheet: %v", s.ID, err)
		} else {
			_ = f.Close()
		}
	}
	for _, id := range config.EmojiStyleIDs {
		if id != "native" && !ids[id] {
			t.Errorf("config offers style %q but it is not embedded", id)
		}
	}
	if ids["openmoji"] {
		t.Error("OpenMoji must not be embedded")
	}
	if len(cat.Styles) != len(config.EmojiStyleIDs)-1 {
		t.Errorf("%d embedded styles, config lists %d non-native", len(cat.Styles), len(config.EmojiStyleIDs)-1)
	}

	basics, ok := cat.Pack("cove-basics")
	if !ok || len(basics.Items) != 48 || basics.Animated {
		t.Fatalf("cove-basics = %+v", basics)
	}
	moves, ok := cat.Pack("cove-moves")
	if !ok || len(moves.Items) < 70 || !moves.Animated {
		t.Fatalf("cove-moves = %+v", moves)
	}
	for _, p := range cat.Packs {
		if p.License == "" || p.Attribution == "" || p.Version == "" {
			t.Errorf("pack %s lacks licence data", p.ID)
		}
		for _, it := range p.Items {
			if it.Emoji == "" || it.Bytes == 0 {
				t.Errorf("%s/%s: %+v", p.ID, it.ID, it)
			}
			if p.Animated && it.Bytes > 512<<10 {
				t.Errorf("%s/%s is %d bytes, over the sticker cap", p.ID, it.ID, it.Bytes)
			}
		}
	}

	// The animated emoji table points at real animations with normalised keys.
	if len(cat.Animated) != len(moves.Items) {
		t.Errorf("%d animated emoji for %d animations", len(cat.Animated), len(moves.Items))
	}
	seen := map[string]bool{}
	for _, a := range cat.Animated {
		if seen[a.Sequence] || a.Sequence != strings.ToLower(a.Sequence) || strings.Contains(a.Sequence, "fe0f") {
			t.Errorf("bad or duplicate sequence %q", a.Sequence)
		}
		seen[a.Sequence] = true
		if _, ok := moves.Item(a.ID); !ok {
			t.Errorf("animated %s points at missing %s", a.Sequence, a.ID)
		}
	}
}

func TestPacksCatalog_LicenceFilesAreEmbedded(t *testing.T) {
	cat, _ := packs.Builtin()
	for _, s := range cat.Styles {
		txt, err := cat.ReadFile(s.LicenseFile)
		if err != nil || len(txt) < 200 {
			t.Errorf("licence text of %s: %v (%d bytes)", s.ID, err, len(txt))
		}
	}
	for _, p := range cat.Packs {
		if txt, err := cat.ReadFile(p.LicenseFile); err != nil || len(txt) < 200 {
			t.Errorf("licence text of %s: %v", p.ID, err)
		}
	}
	att, err := cat.ReadFile("ATTRIBUTION.md")
	if err != nil || !strings.Contains(string(att), "Noto") || strings.Contains(strings.ToLower(string(att)), "openmoji") {
		t.Errorf("ATTRIBUTION.md: %v", err)
	}
}

// ---- image inspection and normalisation --------------------------------------------------------------------------- //

var stickerImgLimits = packs.ImageLimits{MaxBytes: 512 << 10, MaxDim: 512, Formats: []string{"png", "jpeg", "gif", "webp"}}

func TestInspect_IdentifiesByMagicBytes(t *testing.T) {
	p, err := packs.Inspect(pngBytes(t, 30, 20, false))
	if err != nil || p.Format != "png" || p.Width != 30 || p.Height != 20 || p.MIME != "image/png" || p.Animated {
		t.Errorf("png = %+v, %v", p, err)
	}
	g, err := packs.Inspect(gifBytes(t, 12, 8, 3))
	if err != nil || g.Format != "gif" || g.Width != 12 || !g.Animated {
		t.Errorf("animated gif = %+v, %v", g, err)
	}
	g1, _ := packs.Inspect(gifBytes(t, 12, 8, 1))
	if g1.Animated {
		t.Error("a one-frame gif is not animated")
	}
	w, err := packs.Inspect(tinyWebP)
	if err != nil || w.Format != "webp" || w.Width != 1 || w.Height != 1 {
		t.Errorf("webp = %+v, %v", w, err)
	}
	// VP8X header with the animation flag and a 300x200 canvas.
	vp8x := []byte("RIFF\x1e\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x02\x00\x00\x00\x2b\x01\x00\xc7\x00\x00")
	x, err := packs.Inspect(vp8x)
	if err != nil || !x.Animated || x.Width != 300 || x.Height != 200 {
		t.Errorf("vp8x = %+v, %v", x, err)
	}
	for name, data := range map[string][]byte{
		"svg": []byte(svgDoc), "html": []byte("<!doctype html><p>hi"), "empty": nil, "riff but not webp": []byte("RIFF\x00\x00\x00\x00WAVEfmt  xxxxxxxxxxxxxxxxxxxxxxxx"),
		"pdf": []byte("%PDF-1.4 ......"), "truncated png": pngBytes(t, 4, 4, false)[:12],
	} {
		if _, err := packs.Inspect(data); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}

func TestNormalize_StrictFallbackKeepsOnlyWhatFits(t *testing.T) {
	ctx := context.Background()
	const none = "no-such-ffmpeg-binary"
	good := pngBytes(t, 100, 100, false)
	out, info, err := packs.Normalize(ctx, none, good, stickerImgLimits)
	if err != nil || len(out) != len(good) || info.Width != 100 {
		t.Errorf("fitting image: %v", err)
	}
	if _, _, err := packs.Normalize(ctx, none, pngBytes(t, 513, 20, false), stickerImgLimits); err != packs.ErrDimensions {
		t.Errorf("513 px wide = %v, want ErrDimensions", err)
	}
	if _, _, err := packs.Normalize(ctx, none, pngBytes(t, 4097, 4, false), stickerImgLimits); err != packs.ErrDimensions {
		t.Errorf("4097 px (bomb guard) = %v, want ErrDimensions", err)
	}
	if _, _, err := packs.Normalize(ctx, none, pngBytes(t, 450, 450, true), stickerImgLimits); err != packs.ErrTooLarge {
		t.Errorf("heavy image = %v, want ErrTooLarge", err)
	}
	if _, _, err := packs.Normalize(ctx, none, []byte(svgDoc), stickerImgLimits); err != packs.ErrUnsupported {
		t.Errorf("svg = %v, want ErrUnsupported", err)
	}
	// A format outside the allowed list is refused even though it is a real image.
	if _, _, err := packs.Normalize(ctx, none, tinyWebP, packs.ImageLimits{MaxBytes: 1 << 10, MaxDim: 8, Formats: []string{"png"}}); err != packs.ErrUnsupported {
		t.Errorf("webp when only png is allowed = %v", err)
	}
}

func TestNormalize_FFmpegBoundsSizeAndKeepsAnimation(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	ctx := context.Background()
	out, info, err := packs.Normalize(ctx, "ffmpeg", pngBytes(t, 1000, 600, false), stickerImgLimits)
	if err != nil || info.Format != "webp" || info.Width > 512 || info.Height > 512 || info.Width < 500 || len(out) > 512<<10 {
		t.Fatalf("shrunk = %+v, %d bytes, %v", info, len(out), err)
	}
	// Small images are not enlarged.
	_, info, err = packs.Normalize(ctx, "ffmpeg", pngBytes(t, 40, 30, false), stickerImgLimits)
	if err != nil || info.Width != 40 || info.Height != 30 {
		t.Errorf("small image changed size: %+v, %v", info, err)
	}
	_, info, err = packs.Normalize(ctx, "ffmpeg", gifBytes(t, 90, 90, 5), stickerImgLimits)
	if err != nil || !info.Animated || info.Format != "webp" {
		t.Errorf("animated gif = %+v, %v", info, err)
	}
	// Emoji caps: 128 px and 256 KB.
	emoji := packs.ImageLimits{MaxBytes: 256 << 10, MaxDim: 128, Formats: []string{"png", "gif", "webp"}}
	_, info, err = packs.Normalize(ctx, "ffmpeg", pngBytes(t, 400, 400, false), emoji)
	if err != nil || info.Width != 128 || info.Height != 128 {
		t.Errorf("emoji = %+v, %v", info, err)
	}
	if _, err := os.Stat("."); err != nil { // keep os imported for platforms without ffmpeg
		t.Fatal(err)
	}
}
