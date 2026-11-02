import { describe, expect, it } from 'vitest';

import type { DesktopUpdateState } from '../types/update.types';
import {
	bannerKind,
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
		});
		expect(parseUpdateSettings('{"enabled":true}')).toBeNull();
		expect(parseUpdateSettings(undefined)).toBeNull();
	});
});

describe('bannerKind', () => {
	it('shows only for a staged update', () => {
		expect(bannerKind(null, null)).toBeNull();
		expect(bannerKind({ ...ready, phase: 'downloading' }, null)).toBeNull();
		expect(bannerKind(ready, null)).toBe('restart');
	});

	it('offers a download when the install cannot update itself', () => {
		expect(bannerKind({ ...ready, can_install: false }, null)).toBe('download');
	});

	it('stays hidden for a dismissed version but returns for a newer one', () => {
		expect(bannerKind(ready, '1.0.0')).toBeNull();
		expect(bannerKind({ ...ready, latest_version: '1.0.1' }, '1.0.0')).toBe('restart');
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
