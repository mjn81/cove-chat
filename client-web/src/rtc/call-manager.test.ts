import { describe, expect, it, vi } from 'vitest';

vi.mock('./WebRTCManager', () => ({ webRTCManager: { join: vi.fn(async () => {}), leave: vi.fn(async () => {}) } }));
vi.mock('./UdpMediaManager', () => ({ udpMediaManager: { join: vi.fn(async () => {}), leave: vi.fn(async () => {}) } }));

import { callManager, setCallTransport } from './call-manager';
import { webRTCManager } from './WebRTCManager';
import { udpMediaManager } from './UdpMediaManager';

describe('callManager', () => {
	it('uses WebRTC by default and UDP when selected', async () => {
		await callManager.join('c1');
		expect(webRTCManager.join).toHaveBeenCalledWith('c1', undefined);
		setCallTransport(true);
		await callManager.leave(); // still the manager that started the call
		expect(webRTCManager.leave).toHaveBeenCalled();
		await callManager.join('c2');
		expect(udpMediaManager.join).toHaveBeenCalledWith('c2', undefined);
		await callManager.leave();
		expect(udpMediaManager.leave).toHaveBeenCalled();
	});
});
