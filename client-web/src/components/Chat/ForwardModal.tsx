import React, { useState, useMemo } from 'react';
import { Search, Send, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useChannelStore, useAuthStore } from '@/store/store';
import { Avatar } from '../Avatar';
import { type Message } from '@/types/api';
import { decryptMessage, wsSendMessage, getChannelKey } from '@/ws';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { ModalShell } from '@/components/modal-shell';
import { logger } from '@/utils/logger';
import { getChannelDisplayName } from '@/store/store';
import { isDirectMessage } from '@/utils/channel';
import { apiGetFile } from '@/api/client';
import { encryptAndCompressFile } from '@/utils/file';
import { bytesToBase64, base64ToBytes } from '@/ws';
import { apiUploadFile } from '@/api/client';
import { decryptAndDecompressFile } from '@/utils/file';
import { db } from '@/lib/db';

interface ForwardModalProps {
	message: Message & { text?: string };
	onClose: () => void;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({ message, onClose }) => {
	const { t } = useTranslation();
	const { channels } = useChannelStore();
	const { user } = useAuthStore();
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [search, setSearch] = useState('');
	const [sending, setSending] = useState(false);

	const filteredChannels = useMemo(() => {
		return channels
			.filter((c) => {
				const displayName = getChannelDisplayName(c, user?.id || '');
				return displayName.toLowerCase().includes(search.toLowerCase());
			})
			.sort((a, b) => {
				const nameA = getChannelDisplayName(a, user?.id || '');
				const nameB = getChannelDisplayName(b, user?.id || '');
				return nameA.localeCompare(nameB);
			});
	}, [channels, search, user?.id]);

	const handleToggle = (id: string) => {
		setSelectedIds((prev) =>
			prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
		);
	};

	const handleForward = async () => {
		if (selectedIds.length === 0 || sending) return;
		setSending(true);

		try {
			const sourceKey = getChannelKey(message.channel_id);
			if (!sourceKey) throw new Error('Source channel key not found');

			// 1. Get the plain content (text or file metadata)
			let contentText = message.text;
			if (!contentText || contentText === '[encrypted]') {
				contentText = await decryptMessage(message);
			}

			if (!contentText || contentText === '[decryption failed]') {
				throw new Error('Could not decrypt message');
			}

			// 2. Handle different message types
			if (message.type === 'text') {
				// Text is easy: just re-send encrypted for each channel
				for (const targetId of selectedIds) {
					await wsSendMessage(targetId, contentText, 'text');
				}
			} else if (message.type === 'file' || message.type === 'voice') {
				// Files/Voice need re-encryption of the actual binary data
				const meta = JSON.parse(contentText);
				
				// Download and decrypt source file
				const encryptedBuffer = await apiGetFile(meta.file_id, undefined);
				const decryptedData = await decryptAndDecompressFile(
					new Uint8Array(encryptedBuffer),
					base64ToBytes(meta.nonce),
					sourceKey,
					message.type === 'voice'
				);

				// For each target channel, re-encrypt and re-upload
				for (const targetId of selectedIds) {
					const targetKey = getChannelKey(targetId);
					if (!targetKey) continue;

					// Re-encrypt
					// We'll mock a File object for the encryption helper
					const dummyFile = new File([decryptedData as any], meta.name || 'file', { type: meta.mime });
					const processed = await encryptAndCompressFile(dummyFile, targetKey);

					// Upload
					const res = await apiUploadFile(
						new Blob([processed.ciphertext as any], { type: processed.mimeType }),
						processed.mimeType,
						processed.thumbnailCipher ? bytesToBase64(processed.thumbnailCipher) : undefined,
						processed.thumbnailNonce ? bytesToBase64(processed.thumbnailNonce) : undefined,
						undefined,
						targetId,
					);

					const newFileId = (res as any).id;
					try {
						await db.cacheFile(
							newFileId,
							processed.rawBytes,
							processed.mimeType,
							processed.originalSize,
						);
					} catch (cacheErr) {
						logger.warn('Failed to pre-cache forwarded file', { error: String(cacheErr) });
					}

					const newMeta = JSON.stringify({
						file_id: newFileId,
						name: meta.name,
						mime: meta.mime,
						size: meta.size,
						nonce: bytesToBase64(processed.nonce),
						thumb_ciphertext: processed.thumbnailCipher ? bytesToBase64(processed.thumbnailCipher) : undefined,
						thumb_nonce: processed.thumbnailNonce ? bytesToBase64(processed.thumbnailNonce) : undefined,
					});

					await wsSendMessage(targetId, newMeta, message.type, message.type === 'voice' ? 'none' : 'zstd');
				}
			}

			onClose();
		} catch (err) {
			logger.error('Forwarding failed', { error: String(err) });
			toast.error(t('chat.forward.failed'));
		} finally {
			setSending(false);
		}
	};

	return (
		<ModalShell
			open
			onOpenChange={onClose}
			title={t('chat.forward.title')}
			bodyClassName="p-0"
			footer={
				<div className="flex w-full items-center justify-between gap-2">
					<span className="text-sm font-medium text-muted-foreground">
						{t('chat.forward.selected', { count: selectedIds.length })}
					</span>
					<div className="flex gap-2">
						<Button type="button" variant="ghost" onClick={onClose}>
							{t('common.cancel')}
						</Button>
						<Button
							type="button"
							disabled={selectedIds.length === 0 || sending}
							onClick={handleForward}
						>
							{sending ? (
								<>
									<Loader2 size={16} className="animate-spin" />
									{t('chat.forward.sending')}
								</>
							) : (
								<>
									<Send size={16} className="rtl:-scale-x-100" />
									{t('chat.forward.forward')}
								</>
							)}
						</Button>
					</div>
				</div>
			}
		>
			<div className="border-b border-border bg-muted p-4">
				<div className="relative">
					<Search
						className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
						size={18}
					/>
					<Input
						autoFocus
						className="ps-10"
						placeholder={t('chat.forward.search_placeholder')}
						aria-label={t('chat.forward.search_placeholder')}
						autoComplete="off"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
			</div>

			<div className="max-h-[300px] space-y-1 overflow-y-auto p-2">
				{filteredChannels.map((channel) => {
					const isSelected = selectedIds.includes(channel.id);
					const isDM = isDirectMessage(channel);
					const otherId = isDM
						? channel.members.find((m) => m !== user?.id) || channel.id
						: channel.id;

					return (
						<ListRow
							key={channel.id}
							selected={isSelected}
							onClick={() => handleToggle(channel.id)}
							leading={
								<Avatar
									userId={otherId}
									avatarId={isDM ? channel.member_avatars?.[otherId] : undefined}
									size={36}
								/>
							}
							title={getChannelDisplayName(channel, user?.id || '')}
							subtitle={
								isDM
									? t('chat.forward.direct_message')
									: t('chat.forward.members', { count: channel.members.length })
							}
							trailing={
								isSelected ? (
									<CheckCircle2 size={20} className="text-primary" />
								) : (
									<Circle size={20} className="text-muted-foreground opacity-40" />
								)
							}
						/>
					);
				})}
				{filteredChannels.length === 0 && (
					<EmptyState title={t('chat.forward.no_results')} />
				)}
			</div>
		</ModalShell>
	);
};
