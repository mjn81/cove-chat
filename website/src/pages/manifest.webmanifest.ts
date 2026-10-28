import type { APIRoute } from 'astro';
import { APP_NAME, url } from '../lib/site';

/** Web app manifest: gives browsers the icon set and brand colors for "add to home screen" and link previews. */
export const GET: APIRoute = () => {
  const manifest = {
    name: `${APP_NAME} - self-hosted encrypted chat`,
    short_name: APP_NAME,
    description: 'Self-hosted, open-source encrypted chat with group calls and screen sharing.',
    start_url: url('/'),
    scope: url('/'),
    display: 'browser',
    background_color: '#23201f',
    theme_color: '#23201f',
    icons: [
      { src: url('/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: url('/icon-512.png'), sizes: '512x512', type: 'image/png' },
      { src: url('/favicon.svg'), sizes: 'any', type: 'image/svg+xml' },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
};
