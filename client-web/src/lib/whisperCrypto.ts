/**
 * Whisper E2EE Cryptography Engine
 *
 * Implements native Web Crypto ECDH (P-256) key exchange, HKDF-SHA512 key derivation,
 * AES-256-GCM authenticated encryption/decryption, and Signal-grade 60-digit Safety Numbers.
 * All private and session keys are marked `extractable: false` to prevent memory/script exfiltration.
 */

// --- Base64 Serialization Helpers ---

export function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	const len = bytes.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
	const binary = atob(base64);
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// --- Key Exchange (ECDH P-256) ---

/**
 * Generates an ephemeral ECDH keypair with a non-extractable private key.
 */
export async function generateWhisperKeypair(): Promise<CryptoKeyPair> {
	return window.crypto.subtle.generateKey(
		{
			name: 'ECDH',
			namedCurve: 'P-256',
		},
		false, // private key is non-extractable
		['deriveKey', 'deriveBits'],
	);
}

/**
 * Exports the uncompressed raw public key bytes for transmission over WebSocket.
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<Uint8Array> {
	const exported = await window.crypto.subtle.exportKey('raw', publicKey);
	return new Uint8Array(exported);
}

/**
 * Imports a peer's uncompressed raw public key bytes.
 */
export async function importPublicKey(rawBytes: Uint8Array): Promise<CryptoKey> {
	return window.crypto.subtle.importKey(
		'raw',
		rawBytes as any,
		{
			name: 'ECDH',
			namedCurve: 'P-256',
		},
		true,
		[],
	);
}

// --- Safety Number & Shared Secret Derivation ---

export interface DerivedWhisperSecrets {
	sessionKey: CryptoKey;
	safetyNumber: string;
	fingerprintHex: string;
	fingerprintBytes: Uint8Array;
}

/**
 * Formats fingerprint bytes into 12 groups of 5 decimal digits (Signal standard).
 */
export function formatSafetyNumber(fingerprintBytes: Uint8Array): string {
	const view = new DataView(
		fingerprintBytes.buffer,
		fingerprintBytes.byteOffset,
		fingerprintBytes.byteLength,
	);
	const groups: string[] = [];
	for (let i = 0; i < 12; i++) {
		// Use 2 bytes per group mod 100,000 to produce a 5-digit number
		const val = view.getUint16(i * 2, false) % 100000;
		groups.push(val.toString().padStart(5, '0'));
	}
	return groups.join(' ');
}

/**
 * Derives the AES-256-GCM session key and the MITM-proof Safety Number
 * from the ECDH shared secret using domain-separated HKDF.
 */
export async function deriveWhisperSecrets(
	localPrivateKey: CryptoKey,
	remotePublicKey: CryptoKey,
	sessionId: string,
	userA: string,
	userB: string,
): Promise<DerivedWhisperSecrets> {
	// 1. Perform ECDH to obtain 256 bits of shared raw secret
	const sharedBits = await window.crypto.subtle.deriveBits(
		{
			name: 'ECDH',
			public: remotePublicKey,
		},
		localPrivateKey,
		256,
	);

	// 2. Import shared bits as an HKDF master secret
	const hkdfKey = await window.crypto.subtle.importKey(
		'raw',
		sharedBits,
		'HKDF',
		false,
		['deriveKey', 'deriveBits'],
	);

	const salt = new TextEncoder().encode('nodetalk-whisper-salt-v1');

	// 3. Derive AES-256-GCM session key (non-extractable)
	const sessionKey = await window.crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt,
			info: new TextEncoder().encode('nodetalk-whisper-v1-aes-' + sessionId),
		},
		hkdfKey,
		{
			name: 'AES-GCM',
			length: 256,
		},
		false, // non-extractable session key
		['encrypt', 'decrypt'],
	);

	// 4. Derive Safety Number (Fingerprint) bound canonically to both user IDs
	const sortedUsers = [userA, userB].sort().join(':');
	const fingerprintBuffer = await window.crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-512',
			salt,
			info: new TextEncoder().encode('nodetalk-whisper-v1-safety-number-' + sortedUsers),
		},
		hkdfKey,
		256, // 32 bytes (enough for 12 groups of 16-bit blocks)
	);

	const fingerprintBytes = new Uint8Array(fingerprintBuffer);
	const safetyNumber = formatSafetyNumber(fingerprintBytes);
	const fingerprintHex = Array.from(fingerprintBytes.slice(0, 16))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.toUpperCase();

	return {
		sessionKey,
		safetyNumber,
		fingerprintHex,
		fingerprintBytes,
	};
}

// --- Authenticated Encryption / Decryption ---

export interface EncryptedPayload {
	ciphertext: Uint8Array;
	nonce: Uint8Array;
}

/**
 * Encrypts UTF-8 plaintext using AES-256-GCM with a fresh 12-byte random nonce.
 */
export async function whisperEncrypt(
	key: CryptoKey,
	plaintext: string,
): Promise<EncryptedPayload> {
	const nonce = window.crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);

	const ciphertextBuffer = await window.crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: nonce as any,
		},
		key,
		encoded,
	);

	return {
		ciphertext: new Uint8Array(ciphertextBuffer),
		nonce,
	};
}

/**
 * Decrypts an AES-256-GCM ciphertext using the given key and nonce.
 */
export async function whisperDecrypt(
	key: CryptoKey,
	ciphertext: Uint8Array,
	nonce: Uint8Array,
): Promise<string> {
	const decryptedBuffer = await window.crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: nonce as any,
		},
		key,
		ciphertext as any,
	);

	return new TextDecoder().decode(decryptedBuffer);
}

// --- Structured Whisper Payload (Text + Files) ---

export interface WhisperFileAttachment {
	name: string;
	mime: string;
	size: number;
	dataBase64: string;
	thumbBase64?: string;
	type?: 'file' | 'voice' | 'video';
	duration?: number;
	waveform?: number[];
}

export interface WhisperPayloadData {
	text?: string;
	file?: WhisperFileAttachment;
}

/**
 * Encrypts a structured payload (text and/or file) into an AES-256-GCM ciphertext.
 */
export async function whisperEncryptPayload(
	key: CryptoKey,
	payload: WhisperPayloadData,
): Promise<EncryptedPayload> {
	return whisperEncrypt(key, JSON.stringify(payload));
}

/**
 * Decrypts an AES-256-GCM ciphertext into structured payload (text and/or file).
 * Gracefully falls back to plain text if payload is a raw string.
 */
export async function whisperDecryptPayload(
	key: CryptoKey,
	ciphertext: Uint8Array,
	nonce: Uint8Array,
): Promise<WhisperPayloadData> {
	const decoded = await whisperDecrypt(key, ciphertext, nonce);
	try {
		const parsed = JSON.parse(decoded);
		if (typeof parsed === 'object' && parsed !== null && ('text' in parsed || 'file' in parsed)) {
			return parsed as WhisperPayloadData;
		}
		return { text: decoded };
	} catch {
		return { text: decoded };
	}
}

/**
 * Converts a File or Blob into base64 string.
 */
export async function fileToBase64(file: File | Blob): Promise<string> {
	const buffer = await file.arrayBuffer();
	return uint8ArrayToBase64(new Uint8Array(buffer));
}

/**
 * Converts base64 bytes into an in-memory browser Blob URL.
 */
export function base64ToBlobUrl(base64: string, mime: string): string {
	const bytes = base64ToUint8Array(base64);
	const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
	return URL.createObjectURL(blob);
}

