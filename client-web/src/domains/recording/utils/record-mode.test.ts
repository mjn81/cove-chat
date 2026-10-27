import { beforeEach, describe, expect, it } from 'vitest';

import { loadRecordMode, saveRecordMode, toggleRecordMode } from './record-mode';

describe('record mode', () => {
	beforeEach(() => localStorage.clear());

	it('toggles between voice and video', () => {
		expect(toggleRecordMode('voice')).toBe('video');
		expect(toggleRecordMode('video')).toBe('voice');
	});

	it('defaults to voice when nothing is stored', () => {
		expect(loadRecordMode()).toBe('voice');
	});

	it('restores a saved mode', () => {
		saveRecordMode('video');
		expect(loadRecordMode()).toBe('video');
	});

	it('ignores corrupt stored values', () => {
		localStorage.setItem('nodetalk_record_mode', 'banana');
		expect(loadRecordMode()).toBe('voice');
	});
});
