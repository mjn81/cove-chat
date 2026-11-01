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
import { base64ToBytes } from '@/ws';
import { decryptAndDecompressFile } from '@/utils/file';
import { encryptAndUploadFile } from '@/domains/files/utils/upload-encrypted-file';

interface ForwardModalProps {
	/** Messages to forward, oldest first. */
	messages: (Message & { text?: string })[];
	onClose: () => void;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({ messages, onClose }) => {
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

	/** Re-sends one message to every picked chat (files and voice notes are re-encrypted for each). */
	const forwardOne = async (message: Message & { text?: string }) => {
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
			if (message.type === 'text' || message.type === 'invite') {
				// Text is easy: just re-send encrypted for each channel
				for (const targetId of selectedIds) {
					await wsSendMessage(targetId, contentText, message.type);
				}
			} else if (message.type === 'file' || message.type === 'voice' || message.type === 'video') {
				// Files, voice notes and video messages: the bytes are decrypted once with the source key, then encrypted
				// and uploaded again for every target chat (each chat has its own key).
				const meta = JSON.parse(contentText) as {
					file_id: string;
					name?: string;
					mime: string;
					nonce: string;
					duration?: number;
					as_document?: boolean;
				};
				// Audio is stored uncompressed (voice notes and audio files alike); everything else is zstd-compressed.
				const isAudio = meta.mime.startsWith('audio/') || message.type === 'voice';

				const encryptedBuffer = await apiGetFile(meta.file_id, undefined);
				const plain = await decryptAndDecompressFile(
					new Uint8Array(encryptedBuffer),
					base64ToBytes(meta.nonce),
					sourceKey,
					isAudio,
				);
				const copy = new File([plain as BlobPart], meta.name || 'file', { type: meta.mime });

				for (const targetId of selectedIds) {
					const targetKey = getChannelKey(targetId);
					if (!targetKey) throw new Error(`No key for channel ${targetId}`);

					// The same path normal sends take, so thumbnails, waveforms and the local cache come out the same.
					const uploaded = await encryptAndUploadFile({
						file: copy,
						channelKey: targetKey,
						channelId: targetId,
						asDocument: meta.as_document,
						isVideoMessage: message.type === 'video' ? true : undefined,
					});
					const payload = uploaded.metadata({
						duration: meta.duration,
						processingStatus: message.type === 'video' ? 'processing' : undefined,
					});
					await wsSendMessage(targetId, payload, message.type, isAudio ? 'none' : 'zstd');
				}
			}
	};

	const handleForward = async () => {
		if (selectedIds.length === 0 || sending) return;
		setSending(true);
		try {
			// In reading order, so the copies arrive in the order they were written.
			for (const message of messages) await forwardOne(message);
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
