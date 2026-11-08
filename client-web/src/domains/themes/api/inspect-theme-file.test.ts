import { describe, expect, it, vi } from 'vitest';
import { getBuiltinTheme } from '../data/builtin-themes';
import { buildCoveTheme, COVETHEME_LIMITS } from '../utils/covetheme';
import { inspectThemeFile } from './inspect-theme-file';

const bytes = () => buildCoveTheme({ ...getBuiltinTheme('nord')!, id: 'inspect-me', author: 'Sam' });

describe('inspectThemeFile', () => {
	it('parses a valid theme without applying anything', async () => {
		const data = bytes();
		const r = await inspectThemeFile({ size: data.length, load: async () => data });
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.theme.id).toBe('inspect-me');
			expect(r.theme.author).toBe('Sam');
			expect(r.bytes).toBe(data);
		}
	});

	it('refuses an oversized file before downloading it', async () => {
		const load = vi.fn(async () => new Uint8Array());
		const r = await inspectThemeFile({ size: COVETHEME_LIMITS.maxArchiveBytes + 1, load });
		expect(r).toMatchObject({ ok: false, errors: [{ code: 'zip_too_large' }] });
		expect(load).not.toHaveBeenCalled();
	});

	it('reports the validation reason for a file that is not a theme', async () => {
		const r = await inspectThemeFile({ size: 3, load: async () => new Uint8Array([1, 2, 3]) });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0].code).toBe('zip_invalid');
	});

	it('turns a failed download into an error state', async () => {
		const r = await inspectThemeFile({ size: 10, load: async () => { throw new Error('network'); } });
		expect(r).toMatchObject({ ok: false, errors: [{ code: 'download_failed' }] });
	});

	it('never trusts the claimed size: the real bytes are checked too', async () => {
		const big = new Uint8Array(COVETHEME_LIMITS.maxArchiveBytes + 1);
		const r = await inspectThemeFile({ size: 5, load: async () => big });
		expect(r).toMatchObject({ ok: false, errors: [{ code: 'zip_too_large' }] });
	});
});
