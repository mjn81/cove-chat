// Builds app/src/main/assets/emoji/picker.json from @emoji-mart/data (the dataset the web picker uses):
//   node tools/gen_emoji_picker.mjs <path to @emoji-mart/data/sets/15/native.json>
// Output: {"categories":[{"id":"people","emojis":[["😀","grinning face","smile happy",["😀🏻"...]], ...]}]}
// Only names, keywords and skin-tone variants are kept; images come from the server's sprite sheets.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const src = process.argv[2];
if (!src) { console.error('usage: node gen_emoji_picker.mjs <native.json>'); process.exit(1); }
const data = JSON.parse(readFileSync(src, 'utf8'));
const categories = data.categories.map((c) => ({
  id: c.id,
  emojis: c.emojis.flatMap((id) => {
    const e = data.emojis[id];
    if (!e || !e.skins?.length) return [];
    return [[e.skins[0].native, e.name, (e.keywords ?? []).join(' '), e.skins.slice(1).map((s) => s.native)]];
  }),
}));
mkdirSync(new URL('../app/src/main/assets/emoji/', import.meta.url), { recursive: true });
writeFileSync(new URL('../app/src/main/assets/emoji/picker.json', import.meta.url), JSON.stringify({ categories }));
console.log(categories.map((c) => `${c.id}:${c.emojis.length}`).join(' '));
