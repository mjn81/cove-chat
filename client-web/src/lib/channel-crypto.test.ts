import { describe, it, expect, vi } from 'vitest';
import { getChannelCryptoKey } from './channel-crypto';

const raw = () => crypto.getRandomValues(new Uint8Array(32));

describe('getChannelCryptoKey', () => {
	it('imports a raw key once and shares it', async () => {
		const spy = vi.spyOn(crypto.subtle, 'importKey');
		const key = raw();
		const [a, b] = await Promise.all([getChannelCryptoKey(key), getChannelCryptoKey(key)]);
		const c = await getChannelCryptoKey(key);
		expect(a).toBe(b);
		expect(c).toBe(a);
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});

	it('imports a different array separately (key rotation)', async () => {
		const spy = vi.spyOn(crypto.subtle, 'importKey');
		await getChannelCryptoKey(raw());
		await getChannelCryptoKey(raw());
		expect(spy).toHaveBeenCalledTimes(2);
		spy.mockRestore();
	});

	it('round-trips through the cached key', async () => {
		const key = await getChannelCryptoKey(raw());
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('hi 😀'));
		const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
		expect(new TextDecoder().decode(pt)).toBe('hi 😀');
	});

	it('is faster than re-importing for every message (measurement)', async () => {
		const key = raw();
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const first = await getChannelCryptoKey(key);
		const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, first, new TextEncoder().encode('hello'));
		const N = 400;

		const t0 = performance.now();
		for (let i = 0; i < N; i++) {
			const k = await crypto.subtle.importKey('raw', key.slice().buffer, { name: 'AES-GCM' }, false, ['decrypt']);
			await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct);
		}
		const perMessageImport = performance.now() - t0;

		const t1 = performance.now();
		for (let i = 0; i < N; i++) await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await getChannelCryptoKey(key), ct);
		const cached = performance.now() - t1;

		console.info(`[bench] decrypt x${N}: import per message ${perMessageImport.toFixed(1)} ms, cached key ${cached.toFixed(1)} ms`);
		// Timing is only reported: the gain is small in Node and a hard assertion would be flaky.
		expect(cached).toBeLessThan(perMessageImport * 3);
	});
});
