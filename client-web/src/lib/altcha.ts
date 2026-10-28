/**
 * Built-in ALTCHA v1 solver. When an admin turns the sign-up check on, the server hands out a challenge
 * `{ algorithm, challenge, maxnumber, salt, signature }`; the client has to find the number n in
 * [0, maxnumber] with SHA-256(salt + n) === challenge and send it back. No third-party script, no
 * tracking: it is plain CPU work. The hash is implemented here (rather than using `crypto.subtle`) because
 * the search needs hundreds of thousands of digests and the async WebCrypto call costs far more per hash.
 */

/** A challenge as served by `GET /api/captcha/challenge`. */
export interface AltchaChallenge {
	algorithm: string;
	/** Hex SHA-256 of `salt + n` for the secret number n. */
	challenge: string;
	/** Upper bound (inclusive) of the search range. */
	maxnumber: number;
	salt: string;
	/** Server HMAC over `challenge`; echoed back untouched. */
	signature: string;
}

const K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
	0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
	0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
	0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** Processes one 64-byte block of `buf` (starting at `offset`) into the running state `h`, using scratch `w`. */
function compress(h: Uint32Array, buf: Uint8Array, offset: number, w: Uint32Array): void {
	for (let i = 0; i < 16; i++) {
		const j = offset + i * 4;
		w[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
	}
	for (let i = 16; i < 64; i++) {
		const a = w[i - 15];
		const b = w[i - 2];
		const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
		const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
		w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
	}
	let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
	for (let i = 0; i < 64; i++) {
		const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
		const ch = (e & f) ^ (~e & g);
		const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
		const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
		const maj = (a & b) ^ (a & c) ^ (b & c);
		const t2 = (S0 + maj) | 0;
		hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
	}
	h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
	h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
}

/** Writes the SHA-256 padding for a message of `length` bytes into `buf` (which must already hold it). */
function pad(buf: Uint8Array, length: number): void {
	buf[length] = 0x80;
	const bits = length * 8;
	const end = buf.length;
	// Big-endian 64-bit bit length; messages here are far below 2^32 bits so the high word stays zero.
	buf[end - 4] = (bits >>> 24) & 0xff;
	buf[end - 3] = (bits >>> 16) & 0xff;
	buf[end - 2] = (bits >>> 8) & 0xff;
	buf[end - 1] = bits & 0xff;
}

/**
 * SHA-256 of `data` as eight big-endian 32-bit words.
 *
 * @param data the bytes to hash.
 * @returns the digest words (use {@link wordsToHex} for the usual hex form).
 */
export function sha256Words(data: Uint8Array): Uint32Array {
	const blocks = Math.ceil((data.length + 9) / 64);
	const buf = new Uint8Array(blocks * 64);
	buf.set(data);
	pad(buf, data.length);
	const h = Uint32Array.from(INITIAL);
	const w = new Uint32Array(64);
	for (let b = 0; b < blocks; b++) compress(h, buf, b * 64, w);
	return h;
}

/**
 * Formats digest words as lowercase hex.
 *
 * @param words the eight words returned by {@link sha256Words}.
 */
export function wordsToHex(words: Uint32Array): string {
	return Array.from(words, (x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Number of attempts between yields to the event loop; keeps the page responsive while solving. */
const SLICE = 5000;

function abortError(): Error {
	const err = new Error('Aborted');
	err.name = 'AbortError';
	return err;
}

/**
 * Solves an ALTCHA challenge by brute force.
 *
 * @param challenge the challenge from the server.
 * @param signal optional; aborting rejects with an `AbortError` so a closed form stops burning CPU.
 * @returns the base64 payload to send as `captcha` when registering.
 * @throws when the algorithm is unsupported, no number in range solves the challenge, or the signal aborts.
 */
export async function solveChallenge(challenge: AltchaChallenge, signal?: AbortSignal): Promise<string> {
	if (challenge.algorithm !== 'SHA-256') throw new Error(`Unsupported algorithm ${challenge.algorithm}`);
	if (signal?.aborted) throw abortError();

	const target = new Uint32Array(8);
	for (let i = 0; i < 8; i++) target[i] = parseInt(challenge.challenge.slice(i * 8, i * 8 + 8), 16) | 0;

	const prefix = new TextEncoder().encode(challenge.salt);
	const h = new Uint32Array(8);
	const w = new Uint32Array(64);
	const started = performance.now();

	let n = 0;
	// The message length (and so the padding) only changes when the digit count does, so one buffer per
	// digit count is reused and only the digits are rewritten for each attempt.
	for (let digits = 1; n <= challenge.maxnumber; digits++) {
		const upper = Math.min(challenge.maxnumber, 10 ** digits - 1);
		const length = prefix.length + digits;
		const blocks = Math.ceil((length + 9) / 64);
		const buf = new Uint8Array(blocks * 64);
		buf.set(prefix);
		pad(buf, length);

		for (; n <= upper; n++) {
			let rest = n;
			for (let i = length - 1; i >= prefix.length; i--) {
				buf[i] = 0x30 + (rest % 10);
				rest = (rest - (rest % 10)) / 10;
			}
			h.set(INITIAL);
			for (let b = 0; b < blocks; b++) compress(h, buf, b * 64, w);

			if (h[0] === target[0] && h[1] === target[1] && h[2] === target[2] && h[3] === target[3] &&
				h[4] === target[4] && h[5] === target[5] && h[6] === target[6] && h[7] === target[7]) {
				return btoa(JSON.stringify({
					algorithm: challenge.algorithm,
					challenge: challenge.challenge,
					number: n,
					salt: challenge.salt,
					signature: challenge.signature,
					took: Math.round(performance.now() - started),
				}));
			}
			if (n % SLICE === SLICE - 1) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
				if (signal?.aborted) throw abortError();
			}
		}
	}
	throw new Error('No solution found within the allowed range');
}
