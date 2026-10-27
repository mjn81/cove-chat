/**
 * Theme handling shared by the landing page and the Starlight docs.
 * Uses Starlight's own storage key so both stay in sync.
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'starlight-theme';

/** @returns the theme currently applied to <html>. */
export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage can be blocked (private mode); the theme still applies for this page */
  }
}

/**
 * Switches theme with a circular ripple expanding from `origin` (the click point).
 * Falls back to an instant swap when View Transitions are unavailable or motion is reduced.
 * @param origin Viewport coordinates the ripple grows from.
 * @returns the theme that was applied.
 */
export async function toggleTheme(origin: { x: number; y: number }): Promise<Theme> {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduced) {
    apply(next);
    return next;
  }
  const transition = document.startViewTransition(() => apply(next));
  await transition.ready;
  const radius = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  );
  document.documentElement.animate(
    { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
    { duration: 500, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
  );
  return next;
}
