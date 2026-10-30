import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/wails', () => ({ isWails: () => false }));
vi.mock('../wailsjs/go/main/App', () => ({ GetCacheKey: vi.fn() }));

const { decryptBytes, decryptText, encryptBytes, encryptText, isEncryptedText, setCacheKeyProvider } = await import(
	'./cacheCrypto'
);

const newKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

describe('cacheCrypto', () => {
	beforeEach(() => {
		setCacheKeyProvider(() => newKey());
		// One stable key per test, like the real providers.
		let cached: Promise<CryptoKey> | null = null;
		setCacheKeyProvider(() => (cached ??= newKey()));
	});

	it('round-trips text and never leaves the plaintext in the stored value', async () => {
		const stored = await encryptText('meet me at the bridge');
		expect(isEncryptedText(stored)).toBe(true);
		expect(stored).not.toContain('bridge');
		expect(await decryptText(stored)).toBe('meet me at the bridge');
	});

	it('uses a fresh IV each time', async () => {
		expect(await encryptText('same')).not.toBe(await encryptText('same'));
	});

	it('round-trips bytes', async () => {
		const data = new Uint8Array([1, 2, 3, 250, 251, 252]);
		expect(Array.from(await decryptBytes(await encryptBytes(data)))).toEqual(Array.from(data));
	});

	it('reads legacy plaintext unchanged', async () => {
		expect(await decryptText('old plaintext message')).toBe('old plaintext message');
	});

	it('rejects tampered data', async () => {
		const blob = await encryptBytes(new Uint8Array([9, 9, 9]));
		blob[blob.length - 1] ^= 0xff;
		await expect(decryptBytes(blob)).rejects.toBeTruthy();
	});

	it('fails closed instead of storing plaintext when the key is unavailable', async () => {
		setCacheKeyProvider(() => Promise.reject(new Error('app is locked')));
		await expect(encryptText('secret')).rejects.toThrow('locked');
	});
});
