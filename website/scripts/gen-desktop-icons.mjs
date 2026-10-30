// Builds the Windows desktop icons from the brand glyph (branding/cove-mark.svg): the chat bubble alone, with no
// rounded-square box, so it reads like a native taskbar icon. Two colour variants are produced because the
// Windows taskbar is light or dark depending on the user's theme, and the app swaps between them at runtime:
//   icon-light.ico  deeper terracotta (#C4624A, the light-theme primary), for a light taskbar. Also the .exe icon.
//   icon-dark.ico   lighter terracotta (#D9826A, the dark-theme primary), for a dark taskbar.
// Run with `pnpm -C website gen:icons` after changing the glyph; the .ico files are committed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = resolve(root, 'client-desktop/build/windows');
const mark = readFileSync(resolve(root, 'branding/cove-mark.svg'), 'utf8');

/** Sizes Windows asks for: 16 (small taskbar/tray), 20-24 (scaled tray), 32 (taskbar), 40-64 (high DPI), 256 (Explorer). */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/** The brand glyph is #C4624A; a variant is the same drawing with its bubble colour swapped. */
const variants = {
  light: mark,
  dark: mark.replaceAll('#C4624A', '#D9826A'),
};

/** Packs PNG images into a Windows .ico (PNG-in-ICO is supported from Vista on, which covers every target). */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, png }, i) => {
    const e = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, e); // width (0 means 256)
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    entries.writeUInt8(0, e + 2); // palette colours
    entries.writeUInt8(0, e + 3); // reserved
    entries.writeUInt16LE(1, e + 4); // colour planes
    entries.writeUInt16LE(32, e + 6); // bits per pixel
    entries.writeUInt32LE(png.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...images.map((i) => i.png)]);
}

mkdirSync(outDir, { recursive: true });
for (const [name, svg] of Object.entries(variants)) {
  const images = [];
  for (const size of SIZES) {
    // Rasterise straight at the target size (the SVG scales without loss), keeping the alpha channel.
    const png = await sharp(Buffer.from(svg), { density: Math.max(72, Math.round((72 * size) / 64) * 4) })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    images.push({ size, png });
  }
  const file = resolve(outDir, `icon-${name}.ico`);
  writeFileSync(file, packIco(images));
  console.log(`wrote ${file} (${images.length} sizes)`);
}

// The .exe resource icon (Explorer, shortcuts, pinned items) cannot follow the theme, so it uses the variant that
// reads well on both a light and a dark taskbar.
writeFileSync(resolve(outDir, 'icon.ico'), readFileSync(resolve(outDir, 'icon-light.ico')));
console.log('wrote icon.ico (exe resource, light variant)');
