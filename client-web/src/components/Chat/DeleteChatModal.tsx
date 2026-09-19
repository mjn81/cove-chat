import React, { useState } from 'react';
import { Trash2, X, User, Users, Loader2 } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/Avatar';
import { apiDeleteChannel } from '@/api/client';
import { useChannelStore, useAuthStore, getChannelDisplayName } from '@/store/store';
import type { Channel } from '@/types/api';

interface DeleteChatModalProps {
	channel: Channel;
	isOpen: boolean;
	onClose: () => void;
	onDeleted?: () => void;
}

export const DeleteChatModal: React.FC<DeleteChatModalProps> = ({
	channel,
	isOpen,
	onClose,
	onDeleted,
}) => {
	const [deleteForBoth, setDeleteForBoth] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const currentUser = useAuthStore((state) => state.user);
	const removeChannel = useChannelStore((state) => state.removeChannel);
	const activeChannel = useChannelStore((state) => state.activeChannel);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);

	const otherMemberId =
		channel.members.find((m) => m !== currentUser?.id) ||
		channel.members[0] ||
		channel.id;
	const displayName = getChannelDisplayName(channel, currentUser?.id ?? '');

	const handleDelete = async () => {
		setIsDeleting(true);
		try {
			await apiDeleteChannel(channel.id, deleteForBoth);
			removeChannel(channel.id);
			if (activeChannel?.id === channel.id) {
				setActiveChannel(null);
			}
			onDeleted?.();
			onClose();
		} catch (err) {
			console.error('Failed to delete channel:', err);
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && !isDeleting && onClose()}>
			<DialogPortal>
				<DialogOverlay className="z-[1000] backdrop-blur-[2px]" />
				<DialogPrimitive.Content
					className="fixed left-[50%] top-[50%] z-[1001] w-full max-w-md translate-x-[-50%] translate-y-[-50%] outline-none animate-in zoom-in-95 duration-200"
					onClick={(e) => e.stopPropagation()}
				>
					<div className="bg-card w-full rounded-xl shadow-2xl border border-border overflow-hidden">
						{/* Header */}
						<div className="flex items-center justify-between px-6 py-4 border-b border-border bg-accent/30">
							<div className="flex items-center gap-2">
								<Trash2 className="text-destructive" size={20} />
								<DialogPrimitive.Title className="text-lg font-bold text-foreground">
									Delete Chat
								</DialogPrimitive.Title>
							</div>
							<button
								type="button"
								disabled={isDeleting}
								onClick={onClose}
								className="p-1 hover:bg-accent rounded-md text-muted-foreground hover:text-foreground transition-colors outline-none cursor-pointer"
							>
								<X size={20} />
							</button>
						</div>

						{/* Content */}
						<div className="px-6 py-5 space-y-4">
							{/* Target User Info */}
							<div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border/40">
								<Avatar
									userId={otherMemberId}
									avatarId={channel.member_avatars?.[otherMemberId]}
									size={40}
									className="shrink-0"
								/>
								<div className="flex flex-col min-w-0">
									<span className="font-semibold text-sm text-foreground truncate">
										{displayName}
									</span>
									<span className="text-xs text-muted-foreground">
										Direct Message
									</span>
								</div>
							</div>

							<DialogPrimitive.Description className="text-sm text-muted-foreground leading-relaxed">
								Are you sure you want to delete this chat with <strong className="text-foreground">{displayName}</strong>? Choose how you want to delete this conversation:
							</DialogPrimitive.Description>

							{/* Options */}
							<div className="space-y-2.5 pt-1">
								{/* Option 1: Delete only for me */}
								<div
									onClick={() => !isDeleting && setDeleteForBoth(false)}
									className={`flex items-start gap-3 p-3.5 rounded-xl border transition cursor-pointer select-none ${
										!deleteForBoth
											? 'border-primary bg-primary/5 text-foreground ring-1 ring-primary/30'
											: 'border-border/60 hover:border-border hover:bg-accent/40 text-muted-foreground'
									}`}
								>
									<div className={`mt-0.5 p-2 rounded-lg shrink-0 ${!deleteForBoth ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
										<User size={18} />
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center justify-between">
											<span className="text-sm font-semibold text-foreground">
												Delete for me only
											</span>
											<div className={`w-4 h-4 rounded-full border flex items-center justify-center ${!deleteForBoth ? 'border-primary' : 'border-muted-foreground/40'}`}>
												{!deleteForBoth && <div className="w-2 h-2 rounded-full bg-primary" />}
											</div>
										</div>
										<p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
											Removes this chat from your conversation list. {displayName} will still keep their copy of the messages.
										</p>
									</div>
								</div>

								{/* Option 2: Delete for both */}
								<div
									onClick={() => !isDeleting && setDeleteForBoth(true)}
									className={`flex items-start gap-3 p-3.5 rounded-xl border transition cursor-pointer select-none ${
										deleteForBoth
											? 'border-destructive bg-destructive/5 text-foreground ring-1 ring-destructive/30'
											: 'border-border/60 hover:border-border hover:bg-accent/40 text-muted-foreground'
									}`}
								>
									<div className={`mt-0.5 p-2 rounded-lg shrink-0 ${deleteForBoth ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'}`}>
										<Users size={18} />
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center justify-between">
											<span className="text-sm font-semibold text-foreground">
												Delete for me and {displayName}
											</span>
											<div className={`w-4 h-4 rounded-full border flex items-center justify-center ${deleteForBoth ? 'border-destructive' : 'border-muted-foreground/40'}`}>
												{deleteForBoth && <div className="w-2 h-2 rounded-full bg-destructive" />}
											</div>
										</div>
										<p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
											Permanently wipes the entire conversation and all messages for both participants.
										</p>
									</div>
								</div>
							</div>
						</div>

						{/* Footer */}
						<div className="px-6 py-4 bg-accent/30 border-t border-border flex justify-end gap-3">
							<Button
								type="button"
								variant="ghost"
								disabled={isDeleting}
								onClick={onClose}
								className="rounded-lg h-9 px-4 cursor-pointer text-muted-foreground hover:text-foreground"
							>
								Cancel
							</Button>
							<Button
								type="button"
								variant="destructive"
								disabled={isDeleting}
								onClick={handleDelete}
								className="rounded-lg h-9 px-4 font-semibold shadow-md shadow-destructive/20 gap-2 cursor-pointer"
							>
								{isDeleting ? (
									<>
										<Loader2 size={16} className="animate-spin" />
										<span>Deleting...</span>
									</>
								) : (
									<>
										<Trash2 size={16} />
										<span>{deleteForBoth ? 'Delete for both' : 'Delete for me'}</span>
									</>
								)}
							</Button>
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPortal>
		</Dialog>
	);
};
