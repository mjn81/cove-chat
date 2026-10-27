/** Central place for brand + repository constants so no component hard-codes them. */
export const APP_NAME = 'Cove';
export const REPO = 'mjn81/nodetalk';
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
export const GOOD_FIRST_ISSUES_URL = `${ISSUES_URL}?q=is%3Aopen+label%3A%22good+first+issue%22`;
export const DOCKER_SERVER_IMAGE = 'mjn81/nodetalk-server';
export const DOCKER_WEB_IMAGE = 'mjn81/nodetalk-webclient';

/** Prefix a site-relative path with Astro's configured base (GitHub Pages project path or ''). */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
