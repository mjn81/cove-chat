import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Words, solveChallenge, wordsToHex, type AltchaChallenge } from './altcha';

const enc = new TextEncoder();

describe('sha256Words', () => {
	it.each([
		['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
		['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
		['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
	])('matches the known digest of %j', (input, expected) => {
		expect(wordsToHex(sha256Words(enc.encode(input)))).toBe(expected);
	});

	it('agrees with node:crypto across block boundaries', () => {
		for (const len of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 200]) {
			const data = new Uint8Array(len).map((_, i) => (i * 31 + len) & 0xff);
			expect(wordsToHex(sha256Words(data))).toBe(createHash('sha256').update(data).digest('hex'));
		}
	});
});

/** Builds a challenge the way the server does, for a known secret number. */
function makeChallenge(secret: number, maxnumber: number, key = 'k'): AltchaChallenge {
	const salt = `0a1b2c3d4e5f60718293a4b5?expires=${Math.floor(Date.now() / 1000) + 300}`;
	const challenge = createHash('sha256').update(salt + secret).digest('hex');
	return {
		algorithm: 'SHA-256',
		challenge,
		maxnumber,
		salt,
		signature: createHmac('sha256', key).update(challenge).digest('hex'),
	};
}

function decodePayload(payload: string) {
	return JSON.parse(atob(payload)) as Record<string, unknown>;
}

describe('solveChallenge', () => {
	it('finds the secret number and returns the base64 payload the server expects', async () => {
		const c = makeChallenge(1234, 5000);
		const p = decodePayload(await solveChallenge(c));
		expect(p).toMatchObject({
			algorithm: 'SHA-256',
			challenge: c.challenge,
			number: 1234,
			salt: c.salt,
			signature: c.signature,
		});
	});

	it('finds a secret at the edges of the range', async () => {
		expect(decodePayload(await solveChallenge(makeChallenge(0, 100))).number).toBe(0);
		expect(decodePayload(await solveChallenge(makeChallenge(100, 100))).number).toBe(100);
	});

	it('fails when no number in range solves it', async () => {
		await expect(solveChallenge(makeChallenge(900, 500))).rejects.toThrow(/no solution/i);
	});

	it('rejects an unsupported algorithm', async () => {
		await expect(solveChallenge({ ...makeChallenge(1, 10), algorithm: 'MD5' })).rejects.toThrow(/algorithm/i);
	});

	it('stops when aborted', async () => {
		const controller = new AbortController();
		const pending = solveChallenge(makeChallenge(399_999, 400_000), controller.signal);
		controller.abort();
		await expect(pending).rejects.toThrow(/abort/i);
	});
});
