/** Operating systems the download section can highlight; `ios` has no download yet and only marks the "soon" row. */
export type DetectedOs = 'windows' | 'macos' | 'linux' | 'android' | 'ios';

/**
 * Guesses the visitor's operating system from the user agent.
 *
 * iPhone, iPad and iPod user agents say "like Mac OS X", so Apple mobile devices are checked before macOS.
 * Since iPadOS 13 an iPad asks for desktop sites with a plain Macintosh user agent; a Mac never has a
 * multi-touch screen, so `maxTouchPoints > 1` tells them apart.
 *
 * @param userAgent the `navigator.userAgent` string.
 * @param maxTouchPoints `navigator.maxTouchPoints`, used to unmask iPadOS in desktop mode.
 * @returns the detected system, or null when it cannot be told.
 */
export function detectOs(userAgent: string, maxTouchPoints = 0): DetectedOs | null {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/macintosh|mac os x/i.test(userAgent)) return maxTouchPoints > 1 ? 'ios' : 'macos';
  if (/windows/i.test(userAgent)) return 'windows';
  if (/linux|x11/i.test(userAgent)) return 'linux';
  return null;
}
