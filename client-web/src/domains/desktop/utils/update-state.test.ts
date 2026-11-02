import { describe, expect, it } from 'vitest';

import type { DesktopUpdateState } from '../types/update.types';
import {
	DEFAULT_MANIFEST_URL,
	entryKind,
	isUpdateBusy,
	parseUpdateSettings,
	parseUpdateState,
	restartGuard,
} from './update-state';

const ready: DesktopUpdateState = {
	phase: 'ready',
	current_version: '0.9.9',
	latest_version: '1.0.0',
	release_notes: '',
	release_url: '',
	progress_percent: 100,
	error: '',
	checked_at: '',
	up_to_date: false,
	can_install: true,
};

describe('parseUpdateState', () => {
	it('accepts the Go JSON and fills gaps', () => {
		const s = parseUpdateState(JSON.stringify({ phase: 'downloading', latest_version: '1.0.0', progress_percent: 40 }));
		expect(s).toMatchObject({ phase: 'downloading', latest_version: '1.0.0', progress_percent: 40, can_install: false });
	});

	it('accepts an event object and keeps known error codes only', () => {
		expect(parseUpdateState({ phase: 'error', error: 'checksum' })?.error).toBe('checksum');
		expect(parseUpdateState({ phase: 'error', error: 'weird' })?.error).toBe('');
	});

	it('rejects anything that is not an updater state', () => {
		expect(parseUpdateState('{}')).toBeNull();
		expect(parseUpdateState('not json')).toBeNull();
		expect(parseUpdateState({ phase: 'exploded' })).toBeNull();
		expect(parseUpdateState(null)).toBeNull();
	});
});

describe('parseUpdateSettings', () => {
	it('requires both booleans', () => {
		expect(parseUpdateSettings('{"enabled":true,"include_prerelease":false}')).toEqual({
			enabled: true,
			include_prerelease: false,
			auto_download: false,
			manifest_url: DEFAULT_MANIFEST_URL,
		});
		expect(parseUpdateSettings('{"enabled":true,"include_prerelease":true,"auto_download":true,"manifest_url":"https://m.test/x"}')).toEqual({
			enabled: true,
			include_prerelease: true,
			auto_download: true,
			manifest_url: 'https://m.test/x',
		});
		expect(parseUpdateSettings('{"enabled":true}')).toBeNull();
		expect(parseUpdateSettings(undefined)).toBeNull();
	});
});

describe('entryKind', () => {
	it('shows nothing until an update is known', () => {
		expect(entryKind(null)).toBeNull();
		expect(entryKind({ ...ready, phase: 'idle', latest_version: '' })).toBeNull();
		expect(entryKind({ ...ready, phase: 'checking' })).toBeNull();
	});

	it('offers Download for a found update and never downloads by itself', () => {
		expect(entryKind({ ...ready, phase: 'available' })).toBe('download');
	});

	it('follows the download and offers Restart once it is staged', () => {
		expect(entryKind({ ...ready, phase: 'downloading' })).toBe('downloading');
		expect(entryKind(ready)).toBe('restart');
	});

	it('falls back to a manual download when the install cannot update itself', () => {
		expect(entryKind({ ...ready, can_install: false })).toBe('manual');
		expect(entryKind({ ...ready, phase: 'available', can_install: false })).toBe('manual');
	});
});

describe('restartGuard', () => {
	it('asks before ending a call or losing a draft', () => {
		expect(restartGuard({ inCall: false, hasDraft: false })).toBe('ok');
		expect(restartGuard({ inCall: true, hasDraft: false })).toBe('call');
		expect(restartGuard({ inCall: false, hasDraft: true })).toBe('draft');
		expect(restartGuard({ inCall: true, hasDraft: true })).toBe('call_and_draft');
	});
});

describe('isUpdateBusy', () => {
	it('is true while checking, downloading or installing', () => {
		expect(isUpdateBusy({ ...ready, phase: 'checking' })).toBe(true);
		expect(isUpdateBusy({ ...ready, phase: 'installing' })).toBe(true);
		expect(isUpdateBusy(ready)).toBe(false);
		expect(isUpdateBusy(null)).toBe(false);
	});
});
