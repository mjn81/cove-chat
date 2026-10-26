/// <reference types="node" />
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import baseline from './design-guardrails.baseline.json';

/**
 * Design-system ratchet. The legacy UI still contains raw palette colours,
 * hex literals, physical (non-RTL-safe) Tailwind classes and `alert()` calls.
 * Rather than fail on all of them at once, each file may not exceed the count
 * recorded in `design-guardrails.baseline.json`, and new files must have none.
 * When you fix violations, lower the baseline with:
 *   UPDATE_GUARDRAIL_BASELINE=1 pnpm -C client-web test design-guardrails
 */

const SRC = join(__dirname, '..');
const BASELINE_PATH = join(__dirname, 'design-guardrails.baseline.json');

/** Rule name -> pattern. Patterns are global so `match()` counts every hit. */
export const RULES: Record<string, RegExp> = {
	// Theme tokens only: bg-primary, text-muted-foreground, bg-success, ...
	rawPaletteColor:
		/(?<![\w-])(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|shadow)-(?:zinc|gray|slate|neutral|stone|red|green|blue|yellow|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?![\w-])/g,
	// Colour literals belong in index.css as CSS variables.
	hexOrRgbLiteral: /#[0-9a-fA-F]{6}(?![0-9a-fA-F])|\brgba?\(/g,
	// Logical classes only (ms-/me-/ps-/pe-/start-/end-/text-start/...).
	// `left-1/2` and `left-[50%]` are exempt: centring with translate has no logical equivalent.
	physicalClass:
		/(?<![\w-])-?(?:m[lr]|p[lr])-(?:\d|\[|px)|(?<![\w-])-?(?:left|right)-(?!1\/2(?!\d)|\[50%\])(?:\d|\[|px)|(?<![\w-])text-(?:left|right)(?![\w-])|(?<![\w-])border-[lr](?![\w-])|(?<![\w-])rounded-[lr]-/g,
	// Feedback goes through toasts.
	nativeAlert: /(?<![\w.])alert\(/g,
};

/** Every `.tsx` file under `src/`, excluding tests, as repo-relative posix paths. */
function listSourceFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			if (name === 'wailsjs' || name === 'assets') continue;
			listSourceFiles(full, out);
		} else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
			out.push(full);
		}
	}
	return out;
}

/** Violation counts per rule, per file; files without violations are omitted. */
function scan(): Record<string, Record<string, number>> {
	const result: Record<string, Record<string, number>> = {};
	for (const file of listSourceFiles(SRC)) {
		const text = readFileSync(file, 'utf8');
		const counts: Record<string, number> = {};
		for (const [rule, re] of Object.entries(RULES)) {
			// Opt-out for deliberate cases, e.g. LTR media timelines: `guardrail-allow physicalClass: <reason>`.
			if (text.includes(`guardrail-allow ${rule}`)) continue;
			const n = text.match(re)?.length ?? 0;
			if (n > 0) counts[rule] = n;
		}
		if (Object.keys(counts).length > 0) {
			result[relative(SRC, file).split('\\').join('/')] = counts;
		}
	}
	return result;
}

describe('design guardrails', () => {
	const current = scan();

	if (process.env.UPDATE_GUARDRAIL_BASELINE) {
		it('rewrites the baseline', () => {
			writeFileSync(BASELINE_PATH, JSON.stringify(current, null, '\t') + '\n');
		});
		return;
	}

	const known = baseline as Record<string, Record<string, number>>;

	it('introduces no new violations in any file', () => {
		const regressions: string[] = [];
		for (const [file, counts] of Object.entries(current)) {
			for (const [rule, n] of Object.entries(counts)) {
				const allowed = known[file]?.[rule] ?? 0;
				if (n > allowed) regressions.push(`${file}: ${rule} ${n} > baseline ${allowed}`);
			}
		}
		expect(regressions).toEqual([]);
	});

	it('baseline has no stale headroom (run with UPDATE_GUARDRAIL_BASELINE=1 to lower it)', () => {
		const stale: string[] = [];
		for (const [file, counts] of Object.entries(known)) {
			for (const [rule, allowed] of Object.entries(counts)) {
				const n = current[file]?.[rule] ?? 0;
				if (n < allowed) stale.push(`${file}: ${rule} ${n} < baseline ${allowed}`);
			}
		}
		expect(stale).toEqual([]);
	});
});
