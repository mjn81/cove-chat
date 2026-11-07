import { describe, expect, it } from 'vitest';

import { serverRestartStage } from './server-restart';

describe('serverRestartStage', () => {
	const base = { requested: true, sawDown: false, uptimeSeconds: null, baselineUptime: 500 };

	it('is idle until a restart is requested', () => {
		expect(serverRestartStage({ ...base, requested: false })).toBe('idle');
	});
	it('keeps waiting while no poll has succeeded', () => {
		expect(serverRestartStage({ ...base, sawDown: true })).toBe('restarting');
	});
	it('is done when the server answers again after being down', () => {
		expect(serverRestartStage({ ...base, sawDown: true, uptimeSeconds: 3 })).toBe('done');
	});
	it('is done when a fast restart is only visible as a lower uptime', () => {
		expect(serverRestartStage({ ...base, uptimeSeconds: 2 })).toBe('done');
	});
	it('does not mistake the old process still answering for a finished restart', () => {
		expect(serverRestartStage({ ...base, uptimeSeconds: 501 })).toBe('restarting');
	});
});
