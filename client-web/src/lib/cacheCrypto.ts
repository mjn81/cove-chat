import Dexie from 'dexie';
import { isWails } from '@/utils/wails';
import { GetCacheKey } from '../wailsjs/go/main/App';

/** Marks a cached string that is AES-GCM encrypted; anything without it is legacy plaintext. */
const ENC_PREFIX = 'enc1:';
const IV_LENGTH = 12;

type KeyProvider = () => Promise<CryptoKey>;

let provider: KeyProvider | null = null;
let keyPromise: Promise<CryptoKey> | null = null;

function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function bytesToB64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

/**
 * Desktop: the key lives in the OS keystore (behind the optional passcode) and is handed over by the shell,
 * so the cache files in the webview profile cannot be decrypted by anyone who only copies that folder.
 * Throws while the app is locked.
 */
const desktopKey: KeyProvider = async () =>
	crypto.subtle.importKey('raw', b64ToBytes(await GetCacheKey()) as BufferSource, 'AES-GCM', false, [
		'encrypt',
		'decrypt',
	]);

/**
 * Browser: a non-extractable key kept in its own IndexedDB. Scripts cannot export it, but code running in this
 * origin can still use it; this only stops casual reading of the cache files.
 */
const browserKey: KeyProvider = async () => {
	const keys = new Dexie('CoveKeys');
	keys.version(1).stores({ keys: 'id' });
	const row = await keys.table('keys').get('cache');
	if (row?.key) return row.key as CryptoKey;
	const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
	await keys.table('keys').put({ id: 'cache', key });
	return key;
};

/** Replaces the key source (tests, or a future hardware-backed provider). */
export function setCacheKeyProvider(next: KeyProvider | null): void {
	provider = next;
	keyPromise = null;
}

/** Forgets the in-memory key, e.g. when the app locks; the next use fetches it again. */
export function resetCacheKey(): void {
	keyPromise = null;
}

/**
 * Resolves the AES-256-GCM key protecting the on-disk cache.
 *
 * @throws when the desktop shell is locked or the key store is unavailable; callers must then skip the cache
 *         rather than fall back to storing plaintext.
 */
export function getCacheKey(): Promise<CryptoKey> {
	if (!keyPromise) {
		const source = provider ?? (isWails() ? desktopKey : browserKey);
		keyPromise = source().catch((err: unknown) => {
			keyPromise = null;
			throw err;
		});
	}
	return keyPromise;
}

/** Encrypts bytes as `iv || ciphertext+tag`. */
export async function encryptBytes(plain: Uint8Array): Promise<Uint8Array> {
	const key = await getCacheKey();
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource));
	const out = new Uint8Array(IV_LENGTH + ct.length);
	out.set(iv);
	out.set(ct, IV_LENGTH);
	return out;
}

/** Reverses {@link encryptBytes}. @throws if the data was tampered with or the key is wrong. */
export async function decryptBytes(blob: Uint8Array): Promise<Uint8Array> {
	const key = await getCacheKey();
	const iv = blob.subarray(0, IV_LENGTH);
	const ct = blob.subarray(IV_LENGTH);
	return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource));
}

/** Encrypts a string into a self-describing `enc1:` token safe to store in a text field. */
export async function encryptText(text: string): Promise<string> {
	return ENC_PREFIX + bytesToB64(await encryptBytes(new TextEncoder().encode(text)));
}

/**
 * Decrypts a value produced by {@link encryptText}. Legacy plaintext (no prefix) is returned unchanged so a cache
 * written before encryption existed still reads.
 */
export async function decryptText(stored: string): Promise<string> {
	if (!stored.startsWith(ENC_PREFIX)) return stored;
	return new TextDecoder().decode(await decryptBytes(b64ToBytes(stored.slice(ENC_PREFIX.length))));
}

/** Whether a stored string is in the encrypted format. */
export const isEncryptedText = (stored: string): boolean => stored.startsWith(ENC_PREFIX);
