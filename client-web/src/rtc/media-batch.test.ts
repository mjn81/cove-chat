import { describe, expect, it } from 'vitest';
import { base64ToBatch, batchToBase64, packFrames, unpackFrames } from './media-batch';

// Pinned in client-desktop/media_bridge_test.go (TestPackBatchFixture): both ends must produce these bytes.
const FIXTURE = '0007010100' + '00000009' + '00000003' + '616263' + '0102' + '03030100000001' + '00000000';
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('media batch', () => {
	const frames = [
		{ src: 7, kind: 1, codec: 1, flags: 0, ts: 9, data: new TextEncoder().encode('abc') },
		{ src: 258, kind: 3, codec: 3, flags: 1, ts: 1, data: new Uint8Array() },
	];
	it('matches the Go fixture', () => expect(hex(packFrames(frames))).toBe(FIXTURE));
	it('round-trips through base64', () => {
		const back = unpackFrames(base64ToBatch(batchToBase64(packFrames(frames))));
		expect(back.map((f) => ({ ...f, data: hex(f.data) }))).toEqual(frames.map((f) => ({ ...f, data: hex(f.data) })));
	});
	it('handles frames larger than the chunk size', () => {
		const big = new Uint8Array(70_000).fill(5);
		const [f] = unpackFrames(base64ToBatch(batchToBase64(packFrames([{ ...frames[0], data: big }]))));
		expect(f.data.length).toBe(70_000);
	});
	it('rejects truncated input', () => {
		const good = packFrames(frames);
		for (let n = 1; n < good.length; n++) {
			if (n === 16 + 0) continue;
			const cut = good.subarray(0, n);
			if (n === HEADER_AND_ABC) continue; // a clean record boundary is valid
			expect(() => unpackFrames(cut)).toThrow();
		}
	});
});
const HEADER_AND_ABC = 13 + 3;
