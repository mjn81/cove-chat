// Generates the social preview image (1200x630) and the Apple touch icon from the brand assets.
// Run with `pnpm gen:og` after changing the tagline or branding; the PNGs are committed.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mark = readFileSync(resolve(root, '../branding/cove-mark.svg'), 'utf8')
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="0.82" cy="0.05" r="0.9">
      <stop offset="0" stop-color="#d9826a" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#d9826a" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M56 0H0V56" fill="none" stroke="#46413e" stroke-width="1" opacity="0.45"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="#23201f"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(96 150) scale(2.4)">${mark}</g>
  <text x="96" y="390" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="108" font-weight="800" fill="#e8e5e3" letter-spacing="-3">Cove</text>
  <text x="96" y="458" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="40" font-weight="500" fill="#d9826a">Self-hosted encrypted chat</text>
  <text x="96" y="520" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="28" fill="#a39e9b">Messages, group calls and screen sharing on your own server.</text>
  <text x="96" y="580" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="24" fill="#a39e9b">Open source  ·  MIT  ·  Web, desktop, Android</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(resolve(root, 'public/og.png'));
await sharp(resolve(root, '../branding/cove-icon-512.png')).resize(180, 180).png().toFile(resolve(root, 'public/apple-touch-icon.png'));
await sharp(resolve(root, '../branding/cove-icon-512.png')).resize(192, 192).png().toFile(resolve(root, 'public/icon-192.png'));
await sharp(resolve(root, '../branding/cove-icon-512.png')).png().toFile(resolve(root, 'public/icon-512.png'));
console.log('og.png, apple-touch-icon.png, icon-192.png, icon-512.png written');
