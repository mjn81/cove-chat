// Propagates the root VERSION file into the manifests that cannot read it themselves.
// Usage: node scripts/sync-version.mjs [--check]   (--check exits 1 on drift instead of writing)
// Android reads VERSION directly from Gradle, and the Go server is stamped through ldflags.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error(`VERSION "${version}" is not MAJOR.MINOR.PATCH[-pre]`);
  process.exit(1);
}
// Windows file metadata only accepts numeric versions, so desktop drops the pre-release suffix.
const core = version.split('-')[0];

/** Each target is a file plus the regex whose first group is the part to keep and whose match carries the old value. */
const targets = [
  { file: 'client-web/package.json', re: /("version":\s*")[^"]+(")/, value: version },
  { file: 'client-desktop/wails.json', re: /("productVersion":\s*")[^"]+(")/, value: core },
];

const check = process.argv.includes('--check');
let drift = false;
for (const { file, re, value } of targets) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const next = text.replace(re, `$1${value}$2`);
  if (next === text) continue;
  drift = true;
  if (check) console.error(`${file} is out of sync with VERSION (${version})`);
  else {
    writeFileSync(path, next);
    console.log(`updated ${file} -> ${value}`);
  }
}
if (check && drift) process.exit(1);
