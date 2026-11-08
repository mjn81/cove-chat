import { describe, expect, it } from 'vitest';
import { isThemeFile } from './is-theme-file';

describe('isThemeFile', () => {
	it('matches by extension, ignoring case', () => {
		expect(isThemeFile({ name: 'Sunset.covetheme', mime: 'application/octet-stream' })).toBe(true);
		expect(isThemeFile({ name: 'SUNSET.COVETHEME', mime: '' })).toBe(true);
	});
	it('matches by mime type', () => {
		expect(isThemeFile({ name: 'download', mime: 'application/vnd.cove.theme+zip' })).toBe(true);
	});
	it('does not match other files, however they look', () => {
		expect(isThemeFile({ name: 'a.zip', mime: 'application/zip' })).toBe(false);
		expect(isThemeFile({ name: 'covetheme', mime: 'text/plain' })).toBe(false);
		expect(isThemeFile({ name: 'x.covetheme.exe', mime: 'application/x-msdownload' })).toBe(false);
		expect(isThemeFile({ mime: 'image/png' })).toBe(false);
	});
});
