import { init, compress, decompress } from '@bokuweb/zstd-wasm';

let isZstdReady = false;

/**
 * Ensures the ZSTD WASM module is initialized.
 */
export async function ensureZstdReady() {
	if (!isZstdReady) {
		// Vite will bundle the .wasm file and provide the correct path/buffer
		await init();
		isZstdReady = true;
	}
}

/**
 * Compresses an image file to high-efficiency WebP format on the client before upload.
 * Constrains dimensions to max 1920x1920 while preserving aspect ratio.
 * Preserves animated GIFs/SVGs and only uses the WebP output if it successfully optimizes size.
 */
export async function compressImageFile(
	file: File,
	maxDimension = 1920,
	quality = 0.82,
): Promise<File> {
	if (
		!file.type.startsWith('image/') ||
		file.type === 'image/gif' ||
		file.type.includes('svg') ||
		file.type.includes('heic') ||
		file.type.includes('heif')
	) {
		return file;
	}

	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = (e) => {
			const img = new Image();
			img.onload = () => {
				let width = img.width;
				let height = img.height;

				if (width > maxDimension || height > maxDimension) {
					if (width > height) {
						height = Math.round((height * maxDimension) / width);
						width = maxDimension;
					} else {
						width = Math.round((width * maxDimension) / height);
						height = maxDimension;
					}
				}

				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');
				if (!ctx) return resolve(file);

				ctx.drawImage(img, 0, 0, width, height);
				canvas.toBlob(
					(blob) => {
						if (!blob || blob.size >= file.size) {
							// If WebP didn't reduce file size, keep original
							return resolve(file);
						}
						const newName = file.name.replace(/\.[^/.]+$/, '') + '.webp';
						const compressedFile = new File([blob], newName, { type: 'image/webp' });
						resolve(compressedFile);
					},
					'image/webp',
					quality,
				);
			};
			img.onerror = () => resolve(file);
			img.src = e.target?.result as string;
		};
		reader.onerror = () => resolve(file);
		reader.readAsDataURL(file);
	});
}

/**
 * Generates an ultra-compact WebP blur thumbnail from an image file (max 48x48, ~300-500 bytes).
 * When rendered with CSS blur, it provides a smooth progressive placeholder with negligible payload.
 */
async function generateThumbnail(
	file: File,
	maxWidth = 48,
	maxHeight = 48,
): Promise<Uint8Array | null> {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = (e) => {
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement('canvas');
				let width = img.width;
				let height = img.height;

				if (width > height) {
					if (width > maxWidth) {
						height = Math.max(1, Math.round((height * maxWidth) / width));
						width = maxWidth;
					}
				} else {
					if (height > maxHeight) {
						width = Math.max(1, Math.round((width * maxHeight) / height));
						height = maxHeight;
					}
				}

				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');
				if (!ctx) return resolve(null);

				ctx.drawImage(img, 0, 0, width, height);
				canvas.toBlob(
					(blob) => {
						if (!blob) return resolve(null);
						const reader = new FileReader();
						reader.onloadend = () => {
							resolve(new Uint8Array(reader.result as ArrayBuffer));
						};
						reader.readAsArrayBuffer(blob);
					},
					'image/webp',
					0.5,
				);
			};
			img.onerror = () => resolve(null);
			img.src = e.target?.result as string;
		};
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(file);
	});
}

/**
 * Generates a small WebP blur thumbnail from a video file at 1 second.
 */
async function generateVideoThumbnail(file: File, maxWidth = 48, maxHeight = 48): Promise<Uint8Array | null> {
	return new Promise((resolve) => {
		const video = document.createElement('video');
		const url = URL.createObjectURL(file);
		video.src = url;
		video.preload = 'metadata';
		video.muted = true;
		video.playsInline = true;

		video.onloadeddata = () => {
			// Small delay to ensure frames are ready, seek to 1s
			video.currentTime = Math.min(1, video.duration || 0);
		};

		video.onseeked = () => {
			const canvas = document.createElement('canvas');
			let width = video.videoWidth;
			let height = video.videoHeight;

			if (width > height) {
				if (width > maxWidth) {
					height = Math.max(1, Math.round((height * maxWidth) / width));
					width = maxWidth;
				}
			} else {
				if (height > maxHeight) {
					width = Math.max(1, Math.round((width * maxHeight) / height));
					height = maxHeight;
				}
			}

			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) return resolve(null);

			ctx.drawImage(video, 0, 0, width, height);
			canvas.toBlob((blob) => {
				URL.revokeObjectURL(url);
				if (!blob) return resolve(null);
				const reader = new FileReader();
				reader.onloadend = () => {
					resolve(new Uint8Array(reader.result as ArrayBuffer));
				};
				reader.readAsArrayBuffer(blob);
			}, 'image/webp', 0.5);
		};

		video.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(null);
		};
	});
}

/**
 * Extracts normalized peaks from an audio file to represent its waveform.
 * Returns a Uint8Array of values between 0 and 100.
 */
async function generateWaveform(file: File, samples = 60): Promise<Uint8Array | null> {
	try {
		const arrayBuffer = await file.arrayBuffer();
		const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
		const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
		
		const channelData = audioBuffer.getChannelData(0);
		const step = Math.floor(channelData.length / samples);
		const peaks = new Uint8Array(samples);

		for (let i = 0; i < samples; i++) {
			let max = 0;
			for (let j = 0; j < step; j++) {
				const val = Math.abs(channelData[i * step + j]);
				if (val > max) max = val;
			}
			// Normalize to 0-100 range
			peaks[i] = Math.min(100, Math.floor(max * 100));
		}

		await audioCtx.close();
		return peaks;
	} catch (err) {
		console.error('Failed to generate waveform:', err);
		return null;
	}
}

/**
 * Prepares a file for secure upload:
 * 1. Compresses the raw bytes using ZSTD via WASM.
 * 2. Encrypts the compressed bytes using AES-256-GCM and the channel key.
 * 3. Generates a low-res thumbnail if the file is an image.
 */
export async function encryptAndCompressFile(
	file: File,
	channelKey: Uint8Array,
	options?: { asDocument?: boolean },
): Promise<{
	ciphertext: Uint8Array;
	nonce: Uint8Array;
	thumbnailCipher?: Uint8Array;
	thumbnailNonce?: Uint8Array;
	mimeType: string;
	fileName: string;
	originalSize: number;
	rawBytes: Uint8Array;
}> {
	await ensureZstdReady();

	// Automatically compress images to modern WebP on client before encryption UNLESS asDocument is specified
	const effectiveFile = options?.asDocument ? file : await compressImageFile(file);

	const arrayBuffer = typeof (effectiveFile as any).arrayBuffer === 'function'
		? await effectiveFile.arrayBuffer()
		: await new Promise<ArrayBuffer>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result as ArrayBuffer);
				reader.onerror = reject;
				reader.readAsArrayBuffer(effectiveFile);
			});
	const isAudio = effectiveFile.type.startsWith('audio/');
	
	// Skip ZSTD compression for audio files as they are already compressed (Opus/WebM)
	// and additional compression can sometimes cause issues with media headers.
	const processedData = isAudio ? new Uint8Array(arrayBuffer) : compress(new Uint8Array(arrayBuffer), 10);

	// Import channel key for encryption
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		channelKey.buffer as ArrayBuffer,
		'AES-GCM',
		false,
		['encrypt'],
	);

	// Encrypt main file
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ciphertextBuffer = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce as any },
		cryptoKey,
		processedData as any,
	);

	const result: any = {
		ciphertext: new Uint8Array(ciphertextBuffer),
		nonce: nonce,
		mimeType: effectiveFile.type,
		fileName: effectiveFile.name,
		originalSize: effectiveFile.size,
		rawBytes: new Uint8Array(arrayBuffer),
	};

	// Generate thumbnails and waveforms only if NOT treated as a document
	if (!options?.asDocument) {
		// thumbnail (exclude HEIC/HEIF as browsers can't render them natively)
		if (
			effectiveFile.type.startsWith('image/') &&
			!effectiveFile.type.includes('heic') &&
			!effectiveFile.type.includes('heif')
		) {
			const thumb = await generateThumbnail(effectiveFile);
			if (thumb) {
				const thumbNonce = crypto.getRandomValues(new Uint8Array(12));
				const thumbCipher = await crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv: thumbNonce as any },
					cryptoKey,
					thumb as any,
				);
				result.thumbnailCipher = new Uint8Array(thumbCipher);
				result.thumbnailNonce = thumbNonce;
			}
		}

		// thumbnail for videos
		if (effectiveFile.type.startsWith('video/')) {
			const thumb = await generateVideoThumbnail(effectiveFile);
			if (thumb) {
				const thumbNonce = crypto.getRandomValues(new Uint8Array(12));
				const thumbCipher = await crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv: thumbNonce as any },
					cryptoKey,
					thumb as any,
				);
				result.thumbnailCipher = new Uint8Array(thumbCipher);
				result.thumbnailNonce = thumbNonce;
			}
		}

		// waveform for audio
		if (effectiveFile.type.startsWith('audio/')) {
			const peaks = await generateWaveform(effectiveFile);
			if (peaks) {
				const thumbNonce = crypto.getRandomValues(new Uint8Array(12));
				const thumbCipher = await crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv: thumbNonce as any },
					cryptoKey,
					peaks as any,
				);
				result.thumbnailCipher = new Uint8Array(thumbCipher);
				result.thumbnailNonce = thumbNonce;
			}
		}
	}

	return result;
}

/**
 * Decrypts and decompresses a file:
 * 1. Decrypts using AES-256-GCM.
 * 2. Decompresses using ZSTD via WASM.
 */
export async function decryptAndDecompressFile(
	ciphertext: Uint8Array,
	nonce: Uint8Array,
	channelKey: Uint8Array,
	isAudio: boolean = false,
): Promise<Uint8Array> {
	await ensureZstdReady();

	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		channelKey.buffer as ArrayBuffer,
		'AES-GCM',
		false,
		['decrypt'],
	);

	const decrypted = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: nonce as any },
		cryptoKey,
		ciphertext as any,
	);

	const decryptedBytes = new Uint8Array(decrypted);
	if (isAudio) return decryptedBytes;

	const decompressed = decompress(decryptedBytes);
	return decompressed;
}
