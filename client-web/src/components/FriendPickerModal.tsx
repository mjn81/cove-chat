import React, { useState } from 'react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/store';
import { useChannelStore } from '@/store/channels.slice';
import { Avatar as MinidenticonAvatar } from '@/components/Avatar';
import { Search, Send, Check, Loader2, Users } from 'lucide-react';
import { wsSendMessage } from '@/ws';

interface FriendPickerModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	channelId?: string;
	channelName?: string;
	inviteLink?: string;
}

export const FriendPickerModal: React.FC<FriendPickerModalProps> = ({
	open,
	onOpenChange,
	channelId: _channelId,
	channelName,
	inviteLink,
}) => {
	const relationships = useAuthStore((state) => state.relationships);
	const channels = useChannelStore((state) => state.channels);
	const createChannel = useChannelStore((state) => state.createChannel);

	const [search, setSearch] = useState('');
	const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
	const [isSending, setIsSending] = useState(false);
	const [sentSuccess, setSentSuccess] = useState(false);

	const friends = relationships.filter((r) => r.type === 'friend');
	const filteredFriends = friends.filter((f) =>
		f.user?.username.toLowerCase().includes(search.toLowerCase()),
	);

	const toggleSelect = (uid: string) => {
		setSelectedUserIds((prev) =>
			prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
		);
	};

	const handleSendInviteLinks = async () => {
		if (selectedUserIds.length === 0 || !inviteLink) return;

		setIsSending(true);
		try {
			const linkUrl = `${window.location.origin}/join/${inviteLink}`;
			const inviteText = `Join my channel "${channelName || 'channel'}": ${linkUrl}`;

			for (const friendId of selectedUserIds) {
				// Find existing DM channel with friend or create new one
				let dmChannel = channels.find((c) => {
					if (c.name !== '') return false;
					return c.members.includes(friendId) && c.members.length === 2;
				});

				if (!dmChannel) {
					dmChannel = await createChannel('', [friendId], true);
				}

				if (dmChannel) {
					await wsSendMessage(dmChannel.id, inviteText, 'text');
				}
			}

			setSentSuccess(true);
			setTimeout(() => {
				setSentSuccess(false);
				setSelectedUserIds([]);
				onOpenChange(false);
			}, 1500);
		} catch (err) {
			console.error('Failed to send invite links', err);
		} finally {
			setIsSending(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md bg-zinc-950 border border-zinc-800 text-zinc-100 p-6 rounded-2xl shadow-2xl">
				<DialogHeader>
					<DialogTitle className="text-lg font-semibold flex items-center gap-2">
						<Users className="w-5 h-5 text-indigo-400" />
						Send Channel Link to Friends
					</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-3 my-2">
					<div className="relative">
						<Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search friends..."
							className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-xl pl-9 pr-3 py-2 outline-none focus:border-indigo-500"
						/>
					</div>

					<div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 pr-1">
						{filteredFriends.length === 0 ? (
							<div className="text-center py-8 text-xs text-zinc-500">
								{search ? 'No friends match your search.' : 'You have no friends to invite.'}
							</div>
						) : (
							filteredFriends.map((f) => {
								const isSelected = selectedUserIds.includes(f.to_user_id);
								return (
									<div
										key={f.to_user_id}
										onClick={() => toggleSelect(f.to_user_id)}
										className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition border ${
											isSelected
												? 'bg-indigo-950/30 border-indigo-500/50 text-white'
												: 'bg-zinc-900/40 border-zinc-850 hover:bg-zinc-900 text-zinc-300'
										}`}
									>
										<div className="flex items-center gap-3">
											<MinidenticonAvatar
												userId={f.to_user_id}
												avatarId={f.user?.avatar_id}
												size={36}
											/>
											<div>
												<div className="text-sm font-semibold">
													{f.user?.username || 'Friend'}
												</div>
												<div className="text-xs text-zinc-500">
													~{f.user?.domain || 'localhost'}
												</div>
											</div>
										</div>

										<div
											className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
												isSelected
													? 'bg-indigo-600 border-indigo-500 text-white'
													: 'border-zinc-700 bg-zinc-800'
											}`}
										>
											{isSelected && <Check size={12} />}
										</div>
									</div>
								);
							})
						)}
					</div>
				</div>

				<DialogFooter className="flex items-center justify-between pt-2">
					<span className="text-xs text-zinc-400">
						{selectedUserIds.length} friend{selectedUserIds.length === 1 ? '' : 's'} selected
					</span>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
						>
							Cancel
						</Button>
						<Button
							type="button"
							disabled={selectedUserIds.length === 0 || isSending || sentSuccess}
							onClick={handleSendInviteLinks}
							className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium gap-1.5 shadow-md shadow-indigo-600/20"
						>
							{sentSuccess ? (
								<>
									<Check size={14} className="text-emerald-400" />
									<span>Sent!</span>
								</>
							) : isSending ? (
								<>
									<Loader2 size={14} className="animate-spin" />
									<span>Sending...</span>
								</>
							) : (
								<>
									<Send size={14} />
									<span>Send Link</span>
								</>
							)}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export default FriendPickerModal;
