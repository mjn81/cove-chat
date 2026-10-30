import { describe, expect, it } from 'vitest';
import { detectOs } from './detect-os';

const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  ipod: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('detectOs', () => {
  it('recognises the desktop systems', () => {
    expect(detectOs(UA.windows)).toBe('windows');
    expect(detectOs(UA.mac)).toBe('macos');
    expect(detectOs(UA.linux)).toBe('linux');
  });

  it('treats Android as Android, not Linux', () => {
    expect(detectOs(UA.android)).toBe('android');
  });

  it('does not mistake iPhone, iPad and iPod for macOS (their user agents say "like Mac OS X")', () => {
    expect(detectOs(UA.iphone)).toBe('ios');
    expect(detectOs(UA.ipad)).toBe('ios');
    expect(detectOs(UA.ipod)).toBe('ios');
  });

  it('spots an iPad that asks for the desktop site by its touch screen', () => {
    // iPadOS 13+ sends a Macintosh user agent; a real Mac has no multi-touch screen.
    expect(detectOs(UA.mac, 5)).toBe('ios');
    expect(detectOs(UA.mac, 0)).toBe('macos');
    expect(detectOs(UA.mac, 1)).toBe('macos');
  });

  it('returns null when it cannot tell', () => {
    expect(detectOs('')).toBeNull();
    expect(detectOs('SomeBot/1.0 (+https://example.com)')).toBeNull();
  });
});
