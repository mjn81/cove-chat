import React, { useState } from 'react';
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, ChannelInitialsAvatar } from '@/components/Avatar';
import type { Channel } from '@/types/api';
import { isDirectMessage } from '@/utils/channel';
import { getFileUrl } from '@/api/client';
import { useAuthStore } from '@/store/auth.slice';
import { useChannelStore } from '@/store/channels.slice';
import { isAdmin } from '@/utils/role';
import {
	Users,
	Hash,
	Lock,
	Calendar,
	Copy,
	Check,
	SlidersHorizontal,
	Share2,
	Shield,
} from 'lucide-react';

interface ChannelInfoModalProps {
	channel: Channel;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onOpenSettings?: () => void;
}

export const ChannelInfoModal: React.FC<ChannelInfoModalProps> = ({
	channel,
	open,
	onOpenChange,
	onOpenSettings,
}) => {
	const liveChannel = useChannelStore(
		(state) => state.channels.find((c) => c.id === channel.id) || channel,
	);
	const currentUserId = useAuthStore((state) => state.user?.id);
	const isDM = isDirectMessage(liveChannel);
	const otherMemberId = isDM
		? liveChannel.members?.find((m) => m !== currentUserId)
		: undefined;
	const dmAvatarId = otherMemberId
		? liveChannel.member_avatars?.[otherMemberId]
		: undefined;

	const [copied, setCopied] = useState(false);

	const canManage = isAdmin(liveChannel.user_role);

	const handleCopyInvite = () => {
		if (!liveChannel.invite_link) return;
		const fullUrl = `${window.location.origin}/join/${liveChannel.invite_link}`;
		navigator.clipboard.writeText(fullUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const formattedDate = liveChannel.created_at
		? new Date(liveChannel.created_at).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
		  })
		: 'Unknown';

	const memberCount = liveChannel.members?.length ?? 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-[calc(100vw-24px)] max-w-[96vw] sm:max-w-xl md:max-w-2xl p-0 bg-card border border-border text-foreground rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl">
				<DialogTitle className="sr-only">Channel Info - {liveChannel.name}</DialogTitle>

				{/* Header Gradient Banner */}
				<div className="h-32 sm:h-36 w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 relative overflow-hidden">
					<div className="absolute inset-0 bg-black/15" />
					<div className="absolute -bottom-6 -right-6 w-36 h-36 rounded-full bg-white/10 blur-2xl pointer-events-none" />
				</div>

				<div className="px-5 sm:px-8 pb-6 sm:pb-8 flex flex-col gap-5 min-w-0">
					{/* Avatar & Channel Badges Row */}
					<div className="flex items-end justify-between gap-3 -mt-14 sm:-mt-16 relative z-20">
						<div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-card bg-card overflow-hidden shadow-xl flex items-center justify-center shrink-0 ring-1 ring-border/20">
							{isDM && otherMemberId ? (
								<Avatar
									userId={otherMemberId}
									avatarId={dmAvatarId}
									size={112}
								/>
							) : liveChannel.avatar_id ? (
								<img
									src={getFileUrl(liveChannel.avatar_id)}
									alt={liveChannel.name}
									className="w-full h-full object-cover"
									draggable={false}
									onError={(e) => {
										(e.target as HTMLElement).style.display = 'none';
									}}
								/>
							) : (
								<ChannelInitialsAvatar id={liveChannel.id} name={liveChannel.name} size={112} />
							)}
						</div>

						<div className="flex items-center gap-2 pb-2 shrink-0">
							<span
								className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow-xs ${
									liveChannel.is_private
										? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
										: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
								}`}
							>
								{liveChannel.is_private ? (
									<>
										<Lock size={13} className="shrink-0" />
										<span>Private Channel</span>
									</>
								) : (
									<>
										<Hash size={13} className="shrink-0" />
										<span>Public Channel</span>
									</>
								)}
							</span>
						</div>
					</div>

					{/* Channel Name & Description */}
					<div className="flex flex-col gap-1.5 min-w-0">
						<h2 className="text-xl sm:text-2xl font-bold text-foreground truncate leading-tight">
							{liveChannel.name}
						</h2>
						{liveChannel.description ? (
							<p className="text-sm text-muted-foreground leading-relaxed break-words whitespace-pre-wrap">
								{liveChannel.description}
							</p>
						) : (
							<p className="text-xs sm:text-sm text-muted-foreground/70 italic">
								No description set for this channel.
							</p>
						)}
					</div>

					{/* Channel Meta Information Card */}
					<div className="bg-secondary/50 border border-border/70 rounded-2xl p-4 sm:p-5 flex flex-col gap-3.5 min-w-0 w-full shadow-xs">
						<div className="flex items-center justify-between text-sm py-0.5">
							<div className="flex items-center gap-2.5 text-muted-foreground">
								<Users size={16} className="text-primary shrink-0" />
								<span className="font-medium">Members</span>
							</div>
							<span className="font-semibold text-foreground">
								{memberCount} {memberCount === 1 ? 'member' : 'members'}
							</span>
						</div>

						<div className="h-px bg-border/40 w-full" />

						<div className="flex items-center justify-between text-sm py-0.5">
							<div className="flex items-center gap-2.5 text-muted-foreground">
								<Calendar size={16} className="text-primary shrink-0" />
								<span className="font-medium">Created</span>
							</div>
							<span className="font-medium text-foreground/80">{formattedDate}</span>
						</div>

						{liveChannel.user_role && (
							<>
								<div className="h-px bg-border/40 w-full" />
								<div className="flex items-center justify-between text-sm py-0.5">
									<div className="flex items-center gap-2.5 text-muted-foreground">
										<Shield size={16} className="text-primary shrink-0" />
										<span className="font-medium">Your Role</span>
									</div>
									<span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
										{liveChannel.user_role}
									</span>
								</div>
							</>
						)}

						{liveChannel.invite_link && (
							<>
								<div className="h-px bg-border/40 w-full" />
								<div className="flex flex-col gap-2 pt-0.5 min-w-0 w-full">
									<div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
										<span className="flex items-center gap-1.5">
											<Share2 size={13} className="text-primary" />
											<span>Invite Link</span>
										</span>
										<span className="text-[11px] text-muted-foreground/70">
											Share to invite others
										</span>
									</div>
									<div className="flex items-center gap-2 bg-background/80 px-3 py-2 rounded-xl border border-border/80 min-w-0 w-full">
										<span className="text-xs text-muted-foreground truncate flex-1 min-w-0 font-mono select-all">
											{window.location.origin}/join/{liveChannel.invite_link}
										</span>
										<Button
											type="button"
											size="sm"
											onClick={handleCopyInvite}
											className="h-7 px-3 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg shrink-0 gap-1.5 cursor-pointer shadow-sm"
										>
											{copied ? (
												<>
													<Check size={13} className="text-emerald-300" />
													<span>Copied</span>
												</>
											) : (
												<>
													<Copy size={13} />
													<span>Copy</span>
												</>
											)}
										</Button>
									</div>
								</div>
							</>
						)}
					</div>

					{/* Admin Actions */}
					{canManage && onOpenSettings && (
						<Button
							type="button"
							onClick={() => {
								onOpenChange(false);
								onOpenSettings();
							}}
							className="w-full bg-secondary hover:bg-accent text-foreground font-semibold rounded-xl h-11 gap-2 border border-border/60 cursor-pointer shadow-sm transition"
						>
							<SlidersHorizontal size={16} />
							<span>Channel Settings</span>
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};
