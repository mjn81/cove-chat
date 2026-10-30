package main

import (
	"bytes"
	"encoding/binary"
	"image/color"
	"image/png"
	"testing"
)

// icoEntry returns the PNG payload for the entry of the given pixel size (256 is stored as 0).
func icoEntry(t *testing.T, ico []byte, size int) []byte {
	t.Helper()
	if len(ico) < 6 || binary.LittleEndian.Uint16(ico[0:2]) != 0 || binary.LittleEndian.Uint16(ico[2:4]) != 1 {
		t.Fatalf("not an .ico file")
	}
	count := int(binary.LittleEndian.Uint16(ico[4:6]))
	for i := 0; i < count; i++ {
		e := ico[6+i*16 : 6+(i+1)*16]
		w := int(e[0])
		if w == 0 {
			w = 256
		}
		if w != size {
			continue
		}
		length := int(binary.LittleEndian.Uint32(e[8:12]))
		offset := int(binary.LittleEndian.Uint32(e[12:16]))
		return ico[offset : offset+length]
	}
	t.Fatalf("no %dpx entry", size)
	return nil
}

// bubbleColour is the dominant opaque, non-white colour of an icon image: the chat bubble.
func bubbleColour(t *testing.T, ico []byte, size int) color.RGBA {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(icoEntry(t, ico, size)))
	if err != nil {
		t.Fatalf("decode %dpx entry: %v", size, err)
	}
	counts := map[color.RGBA]int{}
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, a := img.At(x, y).RGBA()
			if a>>8 < 250 || (r>>8 > 235 && g>>8 > 235 && bl>>8 > 235) {
				continue
			}
			counts[color.RGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(bl >> 8), A: 255}]++
		}
	}
	var best color.RGBA
	most := 0
	for c, n := range counts {
		if n > most {
			best, most = c, n
		}
	}
	return best
}

func near(a, b color.RGBA) bool {
	d := func(x, y uint8) int {
		if x > y {
			return int(x - y)
		}
		return int(y - x)
	}
	return d(a.R, b.R) <= 6 && d(a.G, b.G) <= 6 && d(a.B, b.B) <= 6
}

func TestIconForTheme_ReturnsDistinctGlyphIconsWithEverySizeWindowsNeeds(t *testing.T) {
	light, dark := iconForTheme(true), iconForTheme(false)
	if bytes.Equal(light, dark) || len(light) == 0 || len(dark) == 0 {
		t.Fatal("the light and dark taskbar icons must both exist and differ")
	}
	for name, ico := range map[string][]byte{"light": light, "dark": dark} {
		for _, size := range []int{16, 20, 24, 32, 48, 256} {
			if _, err := png.Decode(bytes.NewReader(icoEntry(t, ico, size))); err != nil {
				t.Errorf("%s icon, %dpx entry does not decode: %v", name, size, err)
			}
		}
	}
}

func TestIconForTheme_UsesTheMatchingBrandTone(t *testing.T) {
	// A light taskbar gets the deeper terracotta (light-theme primary), a dark one the lighter (dark-theme primary).
	if got, want := bubbleColour(t, iconForTheme(true), 48), (color.RGBA{R: 0xC4, G: 0x62, B: 0x4A, A: 255}); !near(got, want) {
		t.Errorf("light-taskbar bubble = %v, want about %v", got, want)
	}
	if got, want := bubbleColour(t, iconForTheme(false), 48), (color.RGBA{R: 0xD9, G: 0x82, B: 0x6A, A: 255}); !near(got, want) {
		t.Errorf("dark-taskbar bubble = %v, want about %v", got, want)
	}
}

func TestIconForTheme_IsTheBubbleAloneNotABoxedAppIcon(t *testing.T) {
	// The boxed app icon fills its whole canvas; the glyph leaves the corners of the canvas transparent.
	for _, light := range []bool{true, false} {
		img, err := png.Decode(bytes.NewReader(icoEntry(t, iconForTheme(light), 256)))
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range [][2]int{{0, 0}, {255, 0}, {0, 255}, {255, 255}} {
			if _, _, _, a := img.At(p[0], p[1]).RGBA(); a != 0 {
				t.Errorf("light=%v: corner %v is not transparent, so the icon is boxed", light, p)
			}
		}
	}
}
