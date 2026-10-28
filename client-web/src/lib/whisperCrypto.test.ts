import { describe, it, expect } from 'vitest';
import {
	generateWhisperKeypair,
	exportPublicKey,
	importPublicKey,
	deriveWhisperSecrets,
	whisperEncrypt,
	whisperDecrypt,
	whisperEncryptPayload,
	whisperDecryptPayload,
	formatSafetyNumber,
	uint8ArrayToBase64,
	base64ToUint8Array,
} from './whisperCrypto';

describe('whisperCrypto', () => {
	it('encodes and decodes base64 correctly', () => {
		const original = new Uint8Array([0, 1, 2, 254, 255, 128, 42]);
		const b64 = uint8ArrayToBase64(original);
		const decoded = base64ToUint8Array(b64);
		expect(decoded).toEqual(original);
	});

	it('formats safety numbers into 12 groups of 5 decimal digits', () => {
		const bytes = new Uint8Array(32);
		for (let i = 0; i < 32; i++) bytes[i] = i * 7 + 3;
		const sn = formatSafetyNumber(bytes);
		const parts = sn.split(' ');
		expect(parts).toHaveLength(12);
		for (const part of parts) {
			expect(part).toMatch(/^\d{5}$/);
		}
	});

	it('performs ECDH key agreement and derives matching session keys and safety numbers', async () => {
		const userAlice = 'user-alice-111';
		const userBob = 'user-bob-222';
		const sessionId = 'session-12345';

		// 1. Both parties generate ephemeral keypairs
		const aliceKeys = await generateWhisperKeypair();
		const bobKeys = await generateWhisperKeypair();

		// 2. Export public keys (simulates network transmission)
		const alicePubBytes = await exportPublicKey(aliceKeys.publicKey);
		const bobPubBytes = await exportPublicKey(bobKeys.publicKey);

		expect(alicePubBytes.byteLength).toBe(65); // uncompressed P-256 point
		expect(bobPubBytes.byteLength).toBe(65);

		// 3. Import peer public keys
		const aliceImportedBobPub = await importPublicKey(bobPubBytes);
		const bobImportedAlicePub = await importPublicKey(alicePubBytes);

		// 4. Derive shared secrets on both sides
		const aliceSecrets = await deriveWhisperSecrets(
			aliceKeys.privateKey,
			aliceImportedBobPub,
			sessionId,
			userAlice,
			userBob,
		);

		const bobSecrets = await deriveWhisperSecrets(
			bobKeys.privateKey,
			bobImportedAlicePub,
			sessionId,
			userAlice,
			userBob,
		);

		// 5. Verify Safety Numbers match EXACTLY (Zero MITM)
		expect(aliceSecrets.safetyNumber).toBe(bobSecrets.safetyNumber);
		expect(aliceSecrets.fingerprintHex).toBe(bobSecrets.fingerprintHex);
		expect(aliceSecrets.safetyNumber.split(' ')).toHaveLength(12);

		// 6. Test encryption/decryption between Alice and Bob
		const secretMessage = 'Hello Bob, this is an ultra-secure Whisper message! 🔒';
		const encrypted = await whisperEncrypt(aliceSecrets.sessionKey, secretMessage);

		const decryptedByBob = await whisperDecrypt(
			bobSecrets.sessionKey,
			encrypted.ciphertext,
			encrypted.nonce,
		);

		expect(decryptedByBob).toBe(secretMessage);

		// 7. Test reply from Bob to Alice
		const replyMessage = 'Hey Alice, loud and clear over E2EE!';
		const bobEncrypted = await whisperEncrypt(bobSecrets.sessionKey, replyMessage);

		const decryptedByAlice = await whisperDecrypt(
			aliceSecrets.sessionKey,
			bobEncrypted.ciphertext,
			bobEncrypted.nonce,
		);

		expect(decryptedByAlice).toBe(replyMessage);
	});

	it('detects MITM attacks: safety numbers mathematically diverge if keys are substituted', async () => {
		const userAlice = 'user-alice-111';
		const userBob = 'user-bob-222';
		const sessionId = 'session-mitm-test';

		// Alice, Bob, and Eve generate keypairs
		const aliceKeys = await generateWhisperKeypair();
		const bobKeys = await generateWhisperKeypair();
		const eveKeys = await generateWhisperKeypair();

		// Eve intercepts: sends Eve's pubkey to Alice, and Eve's pubkey to Bob
		const evePubBytes = await exportPublicKey(eveKeys.publicKey);
		const aliceImportedEvePub = await importPublicKey(evePubBytes);
		const bobImportedEvePub = await importPublicKey(evePubBytes);

		// Alice derives secret with Eve (thinking it's Bob)
		const aliceSecrets = await deriveWhisperSecrets(
			aliceKeys.privateKey,
			aliceImportedEvePub,
			sessionId,
			userAlice,
			userBob,
		);

		// Bob derives secret with Eve (thinking it's Alice)
		const bobSecrets = await deriveWhisperSecrets(
			bobKeys.privateKey,
			bobImportedEvePub,
			sessionId,
			userAlice,
			userBob,
		);

		// Under MITM, Alice and Bob's safety numbers CANNOT match!
		expect(aliceSecrets.safetyNumber).not.toBe(bobSecrets.safetyNumber);
		expect(aliceSecrets.fingerprintHex).not.toBe(bobSecrets.fingerprintHex);
	});

	it('encrypts and decrypts structured file payloads with zero metadata leakage', async () => {
		const aliceKeys = await generateWhisperKeypair();
		const bobKeys = await generateWhisperKeypair();

		const alicePub = await exportPublicKey(aliceKeys.publicKey);
		const bobImported = await importPublicKey(alicePub);

		const secrets = await deriveWhisperSecrets(
			bobKeys.privateKey,
			bobImported,
			'file-sess',
			'alice',
			'bob',
		);

		const originalPayload = {
			text: 'Confidential photo enclosed 📷',
			file: {
				name: 'secret-document.pdf',
				mime: 'application/pdf',
				size: 1024,
				dataBase64: 'JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmoKPDw...',
			},
		};

		const encrypted = await whisperEncryptPayload(
			secrets.sessionKey,
			originalPayload,
		);

		const decrypted = await whisperDecryptPayload(
			secrets.sessionKey,
			encrypted.ciphertext,
			encrypted.nonce,
		);

		expect(decrypted.text).toBe(originalPayload.text);
		expect(decrypted.file).toBeDefined();
		expect(decrypted.file?.name).toBe('secret-document.pdf');
		expect(decrypted.file?.mime).toBe('application/pdf');
		expect(decrypted.file?.dataBase64).toBe(originalPayload.file.dataBase64);
	});

	it('encrypts and decrypts voice notes with duration and waveform metadata', async () => {
		const aliceKeys = await generateWhisperKeypair();
		const bobKeys = await generateWhisperKeypair();

		const alicePub = await exportPublicKey(aliceKeys.publicKey);
		const bobImported = await importPublicKey(alicePub);

		const secrets = await deriveWhisperSecrets(
			bobKeys.privateKey,
			bobImported,
			'voice-sess',
			'alice',
			'bob',
		);

		const sampleWaveform = [0.1, 0.45, 0.8, 0.95, 0.6, 0.3, 0.75, 0.2];
		const voicePayload = {
			file: {
				name: 'whisper-voice-12345.webm',
				mime: 'audio/webm',
				size: 4096,
				dataBase64: 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAA...',
				type: 'voice' as const,
				duration: 14.5,
				waveform: sampleWaveform,
			},
		};

		const encrypted = await whisperEncryptPayload(
			secrets.sessionKey,
			voicePayload,
		);

		const decrypted = await whisperDecryptPayload(
			secrets.sessionKey,
			encrypted.ciphertext,
			encrypted.nonce,
		);

		expect(decrypted.file).toBeDefined();
		expect(decrypted.file?.type).toBe('voice');
		expect(decrypted.file?.duration).toBe(14.5);
		expect(decrypted.file?.waveform).toEqual(sampleWaveform);
		expect(decrypted.file?.name).toBe('whisper-voice-12345.webm');
		expect(decrypted.file?.mime).toBe('audio/webm');
	});

	it('encrypts and decrypts round video notes with duration metadata', async () => {
		const aliceKeys = await generateWhisperKeypair();
		const bobKeys = await generateWhisperKeypair();

		const alicePub = await exportPublicKey(aliceKeys.publicKey);
		const bobImported = await importPublicKey(alicePub);

		const secrets = await deriveWhisperSecrets(
			bobKeys.privateKey,
			bobImported,
			'video-sess',
			'alice',
			'bob',
		);

		const videoPayload = {
			file: {
				name: 'whisper-video-67890.webm',
				mime: 'video/webm',
				size: 65536,
				dataBase64: 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAA...',
				type: 'video' as const,
				duration: 22.0,
			},
		};

		const encrypted = await whisperEncryptPayload(
			secrets.sessionKey,
			videoPayload,
		);

		const decrypted = await whisperDecryptPayload(
			secrets.sessionKey,
			encrypted.ciphertext,
			encrypted.nonce,
		);

		expect(decrypted.file).toBeDefined();
		expect(decrypted.file?.type).toBe('video');
		expect(decrypted.file?.duration).toBe(22.0);
		expect(decrypted.file?.name).toBe('whisper-video-67890.webm');
		expect(decrypted.file?.mime).toBe('video/webm');
	});
});


// Known-answer test: expected value computed independently with Node's crypto (ECDH + HKDF-SHA512), so a
// change to the 'cove-whisper-*' context strings (which would break Whisper between clients) fails here.
describe('whisper key derivation context strings', () => {
	it('derives the pinned safety fingerprint for fixed keys', async () => {
		const alicePriv = await window.crypto.subtle.importKey(
			'jwk',
			{"kty":"EC","x":"7oyc9WjI0SALfOjYaT--nfXdm5PF5ek2-NOrocvVHAA","y":"iJ13BPgvGXDYtrYHAeHExj8jjp1gYKVx5oGG0TCjhqM","crv":"P-256","d":"dz5Kha1IcG4Q-ESsqn55-kGKC9P_IVktoWJ_nn6zUmY"},
			{ name: 'ECDH', namedCurve: 'P-256' },
			false,
			['deriveBits'],
		);
		const bobPub = await window.crypto.subtle.importKey(
			'jwk',
			{"kty":"EC","x":"EuWnlYl2xJCxMk6-hzoJJl2M62jRDYQNZWwA2MOI2q0","y":"vrbPJLkmGCpxA80ms8SdilG6d5BdhnWzbe6ViUb_JwM","crv":"P-256"},
			{ name: 'ECDH', namedCurve: 'P-256' },
			true,
			[],
		);
		const secrets = await deriveWhisperSecrets(alicePriv, bobPub, 'session-1', 'user-bob', 'user-alice');
		expect(secrets.fingerprintHex).toBe('DFD3C7878E91A761ACE4EF10120B8CDD');
	});
});
