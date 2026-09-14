import React, { useState, useMemo } from 'react';
import { Search, Send, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useChannelStore, useAuthStore } from '@/store/store';
import { Avatar } from '../Avatar';
import { type Message } from '@/types/api';
import { decryptMessage, wsSendMessage, getChannelKey } from '@/ws';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getChannelDisplayName } from '@/store/store';
import { isDirectMessage } from '@/utils/channel';
import { apiGetFile } from '@/api/client';
import { encryptAndCompressFile } from '@/utils/file';
import { bytesToBase64, base64ToBytes } from '@/ws';
import { apiUploadFile } from '@/api/client';
import { decryptAndDecompressFile } from '@/utils/file';

interface ForwardModalProps {
	message: Message & { text?: string };
	onClose: () => void;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({ message, onClose }) => {
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

					const newMeta = JSON.stringify({
						file_id: (res as any).id,
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
			console.error('Forwarding failed:', err);
			alert('Failed to forward message. Encryption keys might be missing.');
		} finally {
			setSending(false);
		}
	};

	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent className="sm:max-w-[425px] p-0 overflow-hidden gap-0">
				<DialogHeader className="p-4 border-b border-border bg-accent/30">
					<DialogTitle className="text-xl font-bold flex items-center gap-2">
						Forward Message
					</DialogTitle>
				</DialogHeader>

				<div className="p-4 bg-accent/10 border-b border-border">
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
						<input
							autoFocus
							className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all"
							placeholder="Search for a person or group..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>
				</div>

				<div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
					{filteredChannels.map((channel) => {
						const isSelected = selectedIds.includes(channel.id);
						const isDM = isDirectMessage(channel);
						const otherId = isDM ? channel.members.find(m => m !== user?.id) || channel.id : channel.id;
						
						return (
							<button
								key={channel.id}
								onClick={() => handleToggle(channel.id)}
								className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
									isSelected ? 'bg-primary/10' : 'hover:bg-accent'
								}`}
							>
								<div className="flex items-center gap-3 min-w-0">
									<Avatar
										userId={otherId}
										avatarId={isDM ? channel.member_avatars?.[otherId] : undefined}
										size={36}
									/>
									<div className="flex flex-col items-start min-w-0">
										<span className="font-semibold text-foreground truncate">
											{getChannelDisplayName(channel, user?.id || '')}
										</span>
										<span className="text-xs text-muted-foreground">
											{isDM ? 'Direct Message' : `${channel.members.length} members`}
										</span>
									</div>
								</div>
								{isSelected ? (
									<CheckCircle2 size={20} className="text-primary fill-primary/10" />
								) : (
									<Circle size={20} className="text-muted-foreground opacity-40" />
								)}
							</button>
						);
					})}
					{filteredChannels.length === 0 && (
						<div className="p-8 text-center text-muted-foreground italic">
							No channels found matching your search.
						</div>
					)}
				</div>

				<div className="p-4 border-t border-border flex items-center justify-between bg-accent/30">
					<span className="text-sm text-muted-foreground font-medium">
						{selectedIds.length} selected
					</span>
					<div className="flex gap-2">
						<button
							onClick={onClose}
							className="px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent rounded-lg transition-colors"
						>
							Cancel
						</button>
						<button
							disabled={selectedIds.length === 0 || sending}
							onClick={handleForward}
							className="px-6 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-lg transition-all flex items-center gap-2 shadow-lg active:scale-95"
						>
							{sending ? (
								<>
									<Loader2 size={16} className="animate-spin" />
									Sending...
								</>
							) : (
								<>
									<Send size={16} />
									Forward
								</>
							)}
						</button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};
