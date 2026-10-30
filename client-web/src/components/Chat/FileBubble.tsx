import { useState, useEffect, memo } from 'react';
import { Loader2 } from 'lucide-react';
import { type Message } from '@/types/api';
import { decryptMessage, getChannelKey, base64ToBytes, onWS } from '@/ws';
import { decryptAndDecompressFile, ensureZstdReady } from '@/utils/file';
import { apiGetFile } from '@/api/client';
import { db } from '@/lib/db';
import { isWails } from '@/utils/wails';
import { RevealFile, SaveFile } from '../../wailsjs/go/main/App';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { bytesToBase64 } from '@/ws';
import { useAuthStore } from '@/store/store';


import { VoiceBubble } from './File/VoiceBubble';
import { ImageVideoBubble } from './File/ImageVideoBubble';
import { GenericFileBubble } from './File/GenericFileBubble';

interface FileBubbleProps {
	msg: Message;
}

interface FileMetadata {
	file_id: string;
	name?: string;
	mime: string;
	size: number;
	duration?: number;
	nonce: string;
	thumb_ciphertext?: string;
	thumb_nonce?: string;
	as_document?: boolean;
}

export const FileBubble = memo(({ msg }: FileBubbleProps) => {
	const { t } = useTranslation();
	const [meta, setMeta] = useState<FileMetadata | null>(null);
	const [thumbUrl, setThumbUrl] = useState<string | null>(null);
	const [isDecrypting, setIsDecrypting] = useState(false);
	const [progress, setProgress] = useState(0);
	const [fullUrl, setFullUrl] = useState<string | null>(null);
	const [waveform, setWaveform] = useState<number[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let currentThumbUrl: string | null = null;

		const loadMeta = async () => {
			const key = getChannelKey(msg.channel_id);
			if (!key) return;

			try {
				const decrypted = await decryptMessage(msg);
				if (decrypted === '[encrypted]' || decrypted === '[decryption failed]')
					return;

				const parsed = JSON.parse(decrypted) as FileMetadata;
				setMeta(parsed);

				// Check IndexedDB cache for already downloaded/opened file
				let hasOpened = false;
				try {
					const cached = await db.getCachedFile(parsed.file_id);
					if (cached) {
						const blob = new Blob([cached.data as any], { type: cached.mime });
						setFullUrl(URL.createObjectURL(blob));
						hasOpened = true;
					}
				} catch (cacheErr) {
					console.warn('Failed to load cached file from db:', cacheErr);
				}

				// The sender should not need to download the file they sent; it should come in opened state
				const currentUser = useAuthStore.getState().user;
				const isOwn = currentUser?.id === msg.sender_id;
				if (
					!hasOpened &&
					isOwn &&
					!parsed.as_document &&
					(parsed.mime.startsWith('image/') || parsed.mime.startsWith('video/'))
				) {
					try {
						const encryptedBuffer = await apiGetFile(parsed.file_id);
						const decrypted = await decryptAndDecompressFile(
							new Uint8Array(encryptedBuffer),
							base64ToBytes(parsed.nonce),
							key,
							false,
						);
						await db.cacheFile(parsed.file_id, decrypted, parsed.mime);
						const blob = new Blob([decrypted as any], { type: parsed.mime });
						setFullUrl(URL.createObjectURL(blob));
					} catch (autoErr) {
						console.warn('Auto-opening sender media failed:', autoErr);
					}
				}

				// Prepare thumbnail or waveform if present (and not treated as a raw document)
				if (!parsed.as_document && parsed.thumb_ciphertext && parsed.thumb_nonce) {
					await ensureZstdReady();
					const thumbCipher = base64ToBytes(parsed.thumb_ciphertext);
					const thumbNonce = base64ToBytes(parsed.thumb_nonce);

					const cryptoKey = await crypto.subtle.importKey(
						'raw',
						key.buffer as ArrayBuffer,
						{ name: 'AES-GCM' },
						false,
						['decrypt'],
					);
					const decryptedThumb = await crypto.subtle.decrypt(
						{ name: 'AES-GCM', iv: thumbNonce as any },
						cryptoKey,
						thumbCipher as any,
					);

					if (parsed.mime.startsWith('audio/') || msg.type === 'voice') {
						setWaveform(Array.from(new Uint8Array(decryptedThumb)));
					} else {
						const blob = new Blob([decryptedThumb], { type: 'image/webp' });
						if (currentThumbUrl) URL.revokeObjectURL(currentThumbUrl);
						currentThumbUrl = URL.createObjectURL(blob);
						setThumbUrl(currentThumbUrl);
					}
				}
			} catch (err) {
				console.error('FileBubble error:', err);
				setError('Failed to load file preview');
			}
		};

		loadMeta();

		const unsubKey = onWS('channel_key', (payload: any) => {
			if (payload.channel_id === msg.channel_id) {
				loadMeta();
			}
		});

		return () => {
			unsubKey();
			if (currentThumbUrl) URL.revokeObjectURL(currentThumbUrl);
		};
	}, [msg]);

	useEffect(() => {
		return () => {
			if (fullUrl) URL.revokeObjectURL(fullUrl);
		};
	}, [fullUrl]);

	const handleDownload = async (e?: React.MouseEvent) => {
		e?.stopPropagation();
		if (!meta || isDecrypting) return;
		setIsDecrypting(true);
		setProgress(0);
		setError(null);

		try {
			let decrypted: Uint8Array;
			const cached = await db.getCachedFile(meta.file_id);
			if (cached) {
				decrypted = cached.data;
			} else {
				const key = getChannelKey(msg.channel_id);
				if (!key) throw new Error('Missing channel key');
				const encryptedBuffer = await apiGetFile(meta.file_id, (pe) => {
					const pct = Math.round((pe.loaded * 100) / pe.total);
					setProgress(pct);
				});

				decrypted = await decryptAndDecompressFile(
					new Uint8Array(encryptedBuffer),
					base64ToBytes(meta.nonce),
					key,
					meta.mime.startsWith('audio/') || msg.type === 'voice',
				);
				await db.cacheFile(meta.file_id, decrypted, meta.mime);
			}

			// If it's an image or video, also update fullUrl so it unblurs (unless it's a raw document)
			if (!meta.as_document && (meta.mime.startsWith('image/') || meta.mime.startsWith('video/'))) {
				if (!fullUrl) {
					const blob = new Blob([decrypted as any], { type: meta.mime });
					setFullUrl(URL.createObjectURL(blob));
				}
			}

			const blob = new Blob([decrypted as any], { type: meta.mime });
			const filename = meta.name || `file-${meta.file_id.substring(0, 8)}.${meta.mime.split('/')[1] || 'bin'}`;

			if (isWails()) {
				// The shell saves straight into <Downloads>/Cove (no dialog, like Telegram) and returns the final path.
				const savedPath = await SaveFile(filename, bytesToBase64(decrypted as any));
				toast.success(t('downloads.savedTo', { path: 'Downloads/Cove' }), {
					description: filename,
					action: { label: t('downloads.showInFolder'), onClick: () => void RevealFile(savedPath) },
				});
			} else {
				const downloadUrl = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = downloadUrl;
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				setTimeout(() => URL.revokeObjectURL(downloadUrl), 100);
			}
		} catch (err) {
			console.error('Download error:', err);
			setError('Download failed');
		} finally {
			setIsDecrypting(false);
			setProgress(0);
		}
	};

	const handleFullscreen = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (fullUrl) return;

		if (!meta || isDecrypting) return;
		setIsDecrypting(true);
		setProgress(0);

		try {
			let decrypted: Uint8Array;
			const cached = await db.getCachedFile(meta.file_id);
			if (cached) {
				decrypted = cached.data;
			} else {
				const key = getChannelKey(msg.channel_id);
				if (!key) throw new Error('Missing channel key');
				const encryptedBuffer = await apiGetFile(meta.file_id, (pe) => {
					const pct = Math.round((pe.loaded * 100) / pe.total);
					setProgress(pct);
				});
				decrypted = await decryptAndDecompressFile(
					new Uint8Array(encryptedBuffer),
					base64ToBytes(meta.nonce),
					key,
					meta.mime.startsWith('audio/') || msg.type === 'voice',
				);
				await db.cacheFile(meta.file_id, decrypted, meta.mime);
			}
			const blob = new Blob([decrypted as any], { type: meta.mime });
			const url = URL.createObjectURL(blob);
			setFullUrl(url);
		} catch (err) {
			console.error('Fullscreen error:', err);
			setError('Failed to load full content');
		} finally {
			setIsDecrypting(false);
			setProgress(0);
		}
	};

	if (!meta) {
		return (
			<div className="mt-2 flex items-center gap-2 text-muted-foreground text-sm animate-pulse italic">
				<Loader2 size={14} className="animate-spin" /> Decrypting metadata...
			</div>
		);
	}

	const isDocument = Boolean(meta.as_document);
	const isAudio = !isDocument && (meta.mime.startsWith('audio/') || msg.type === 'voice');
	const isImage = !isDocument && (meta.mime.startsWith('image/') && !meta.mime.includes('heic'));
	const isVideo = !isDocument && meta.mime.startsWith('video/');

	return (
		<div className="mt-2 group/bubble max-w-[400px]">
			{isAudio ? (
				<VoiceBubble
					meta={meta}
					channelId={msg.channel_id}
					waveform={waveform}
					handleDownload={handleDownload}
				/>
			) : isImage || isVideo ? (
				<ImageVideoBubble
					meta={meta}
					thumbUrl={thumbUrl}
					fullUrl={fullUrl}
					isDecrypting={isDecrypting}
					progress={progress}
					handleDownload={handleDownload}
					handleFullscreen={handleFullscreen}
				/>
			) : (
				<GenericFileBubble
					meta={meta}
					isDecrypting={isDecrypting}
					progress={progress}
					handleDownload={handleDownload}
				/>
			)}

			{error && <div className="text-destructive text-xs mt-1">{error}</div>}
		</div>
	);
});

FileBubble.displayName = 'FileBubble';
