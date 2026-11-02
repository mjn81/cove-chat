import { describe, expect, it } from 'vitest';

import type { ServerUpdateInfo } from '../types/admin.types';
import { classifyChecksumInput, isUpdateBusy, previewReleaseNotes, serverUpdateStage } from './server-update';

const info = (over: Partial<ServerUpdateInfo> = {}): ServerUpdateInfo => ({
	current_version: '0.9.9',
	latest_version: '1.0.0',
	update_available: true,
	release_notes: '',
	prerelease: false,
	mode: 'binary',
	can_update: true,
	state: 'idle',
	progress_percent: 0,
	...over,
});

describe('serverUpdateStage', () => {
	it('is idle when nothing runs and this browser started nothing', () => {
		expect(serverUpdateStage({ info: info(), target: null, pollFailed: false })).toBe('idle');
		expect(serverUpdateStage({ info: undefined, target: null, pollFailed: false })).toBe('idle');
	});

	it('mirrors a job started by another admin', () => {
		expect(serverUpdateStage({ info: info({ state: 'downloading' }), target: null, pollFailed: false })).toBe(
			'downloading',
		);
	});

	it('walks downloading, installing and restarting for the starter', () => {
		const t = '1.0.0';
		expect(serverUpdateStage({ info: info({ state: 'downloading' }), target: t, pollFailed: false })).toBe(
			'downloading',
		);
		expect(serverUpdateStage({ info: info({ state: 'installing' }), target: t, pollFailed: false })).toBe(
			'installing',
		);
		expect(serverUpdateStage({ info: info({ state: 'restarting' }), target: t, pollFailed: false })).toBe(
			'restarting',
		);
	});

	it('shows reconnecting while polls fail during the restart', () => {
		expect(serverUpdateStage({ info: info({ state: 'restarting' }), target: '1.0.0', pollFailed: true })).toBe(
			'reconnecting',
		);
	});

	it('is done only when the server returns idle on the new version', () => {
		expect(serverUpdateStage({ info: info({ current_version: '0.9.9' }), target: '1.0.0', pollFailed: false })).toBe(
			'downloading',
		);
		expect(serverUpdateStage({ info: info({ current_version: '1.0.0' }), target: '1.0.0', pollFailed: false })).toBe(
			'done',
		);
	});

	it('reports a failed job', () => {
		expect(
			serverUpdateStage({ info: info({ state: 'failed', error: 'x' }), target: '1.0.0', pollFailed: false }),
		).toBe('failed');
	});
});

describe('isUpdateBusy', () => {
	it('is true only while a job is in flight', () => {
		expect(isUpdateBusy('downloading')).toBe(true);
		expect(isUpdateBusy('reconnecting')).toBe(true);
		expect(isUpdateBusy('idle')).toBe(false);
		expect(isUpdateBusy('done')).toBe(false);
		expect(isUpdateBusy('failed')).toBe(false);
	});
});

describe('previewReleaseNotes', () => {
	it('keeps short notes and truncates long ones', () => {
		expect(previewReleaseNotes('  fixes  ')).toBe('fixes');
		expect(previewReleaseNotes('a'.repeat(300), 10)).toBe(`${'a'.repeat(10)}…`);
	});
});

describe('classifyChecksumInput', () => {
	it('treats a lone digest as sha256 and anything else as a SHA256SUMS file', () => {
		const hex = 'A'.repeat(64);
		expect(classifyChecksumInput(`  ${hex}\n`)).toEqual({ sha256: 'a'.repeat(64) });
		expect(classifyChecksumInput(`${hex}  cove-server-linux-amd64.zip`)).toEqual({
			sums: `${hex}  cove-server-linux-amd64.zip`,
		});
		expect(classifyChecksumInput('   ')).toEqual({});
	});
});
