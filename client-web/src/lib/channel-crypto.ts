/**
 * Imported AES-GCM keys for the channel keys held in the crypto store. `crypto.subtle.importKey` is asynchronous and
 * was previously called once per message (a 50-message page meant 50 imports before anything could be shown); the
 * imported `CryptoKey` is reusable, so it is imported once per raw key and shared.
 */

const imported = new WeakMap<Uint8Array, Promise<CryptoKey>>();

/**
 * The AES-GCM `CryptoKey` for a raw channel key, imported at most once per key array. The cache is keyed by the
 * array object held in the store, so replacing a channel's key (rotation) naturally misses and re-imports, and
 * dropping the key lets the entry be garbage collected.
 *
 * @param raw - The 32-byte channel key.
 * @returns a key usable for both `encrypt` and `decrypt`.
 */
export function getChannelCryptoKey(raw: Uint8Array): Promise<CryptoKey> {
	let hit = imported.get(raw);
	if (!hit) {
		const copy = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
		hit = crypto.subtle.importKey('raw', copy, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
		// A failed import must not be cached forever.
		hit.catch(() => imported.delete(raw));
		imported.set(raw, hit);
	}
	return hit;
}
