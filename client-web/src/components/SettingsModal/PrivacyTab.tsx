import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Users, MessageSquare, UserPlus, Check, Loader2, ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/store/store';
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';

export const PrivacyTab = () => {
	const { t } = useTranslation();
	const user = useAuthStore((state) => state.user);
	const updateUser = useAuthStore((state) => state.updateUser);

	const [allowChannelAdds, setAllowChannelAdds] = useState<'everyone' | 'friends' | 'nobody'>(
		user?.allow_channel_adds || 'everyone',
	);
	const [dmPermission, setDmPermission] = useState<'everyone' | 'friends' | 'nobody'>(
		user?.dm_permission || 'everyone',
	);
	const [friendRequestPermission, setFriendRequestPermission] = useState<'everyone' | 'nobody'>(
		user?.friend_request_permission || 'everyone',
	);

	const [isSaving, setIsSaving] = useState(false);
	const [savedRecently, setSavedRecently] = useState(false);

	const handleSave = async (updates: {
		allow_channel_adds?: 'everyone' | 'friends' | 'nobody';
		dm_permission?: 'everyone' | 'friends' | 'nobody';
		friend_request_permission?: 'everyone' | 'nobody';
	}) => {
		setIsSaving(true);
		try {
			await updateUser(updates);
			setSavedRecently(true);
			setTimeout(() => setSavedRecently(false), 2000);
		} catch (err) {
			console.error('Failed to update privacy settings', err);
		} finally {
			setIsSaving(false);
		}
	};

	const channelAddLabels: Record<'everyone' | 'friends' | 'nobody', string> = {
		everyone: 'Everyone (Anyone can add you directly)',
		friends: 'Friends Only (Only friended users can add you)',
		nobody: 'Nobody (Must send you an invite link)',
	};

	const dmPermissionLabels: Record<'everyone' | 'friends' | 'nobody', string> = {
		everyone: 'Everyone (Anyone can message you)',
		friends: 'Friends Only (Only friends can initiate DMs)',
		nobody: 'Nobody (Disable direct messages)',
	};

	const friendRequestLabels: Record<'everyone' | 'nobody', string> = {
		everyone: 'Everyone (Anyone can send friend requests)',
		nobody: 'Nobody (Disable incoming friend requests)',
	};

	return (
		<div className="w-full max-w-[560px] mx-auto animate-in fade-in slide-in-from-right-4 duration-300 pb-8">
			<div className="flex items-center justify-between mb-6">
				<div className="flex items-center gap-2.5">
					<div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
						<Shield size={20} />
					</div>
					<div>
						<h2 className="text-xl font-bold text-foreground">
							{t('settings.privacy')}
						</h2>
						<p className="text-xs text-muted-foreground">
							Control who can interact with you and add you to groups
						</p>
					</div>
				</div>

				{savedRecently && (
					<div className="flex items-center gap-1.5 text-success bg-success/10 border border-success/30 px-3 py-1 rounded-full text-xs font-medium animate-in fade-in zoom-in-95">
						<Check size={14} />
						<span>Saved</span>
					</div>
				)}
				{isSaving && (
					<div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
						<Loader2 size={14} className="animate-spin text-primary" />
						<span>Saving...</span>
					</div>
				)}
			</div>

			<div className="flex flex-col gap-6">
				{/* 1. Channel Add Permissions */}
				<div className="bg-card/60 border border-border/70 rounded-2xl p-5 shadow-sm hover:border-border transition flex flex-col gap-3">
					<div className="flex items-start gap-3">
						<div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
							<Users size={18} />
						</div>
						<div className="flex-1">
							<span className="text-sm font-bold text-foreground block">
								Who can add me to channels
							</span>
							<p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
								Decide who can add you directly to channels. If restricted, others must send you an invite link.
							</p>
						</div>
					</div>

					<div className="mt-1">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="w-full bg-secondary/80 border border-border/80 hover:border-primary/60 text-foreground text-sm rounded-xl px-3.5 py-2.5 outline-none transition cursor-pointer font-medium flex items-center justify-between"
								>
									<span className="truncate">{channelAddLabels[allowChannelAdds]}</span>
									<ChevronDown size={16} className="text-muted-foreground ms-2 shrink-0" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] bg-popover border-border text-foreground p-1 rounded-xl shadow-xl z-50">
								<DropdownMenuRadioGroup
									value={allowChannelAdds}
									onValueChange={(val) => {
										const typed = val as 'everyone' | 'friends' | 'nobody';
										setAllowChannelAdds(typed);
										handleSave({ allow_channel_adds: typed });
									}}
								>
									<DropdownMenuRadioItem value="everyone" className="rounded-lg py-2 cursor-pointer text-sm">
										Everyone (Anyone can add you directly)
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="friends" className="rounded-lg py-2 cursor-pointer text-sm">
										Friends Only (Only friended users can add you)
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="nobody" className="rounded-lg py-2 cursor-pointer text-sm">
										Nobody (Must send you an invite link)
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				{/* 2. Direct Message Permissions */}
				<div className="bg-card/60 border border-border/70 rounded-2xl p-5 shadow-sm hover:border-border transition flex flex-col gap-3">
					<div className="flex items-start gap-3">
						<div className="w-8 h-8 rounded-lg bg-success/10 text-success flex items-center justify-center shrink-0 mt-0.5">
							<MessageSquare size={18} />
						</div>
						<div className="flex-1">
							<span className="text-sm font-bold text-foreground block">
								Who can send me direct messages
							</span>
							<p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
								Filter incoming direct conversations. Blocked users can never message you regardless of this setting.
							</p>
						</div>
					</div>

					<div className="mt-1">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="w-full bg-secondary/80 border border-border/80 hover:border-primary/60 text-foreground text-sm rounded-xl px-3.5 py-2.5 outline-none transition cursor-pointer font-medium flex items-center justify-between"
								>
									<span className="truncate">{dmPermissionLabels[dmPermission]}</span>
									<ChevronDown size={16} className="text-muted-foreground ms-2 shrink-0" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] bg-popover border-border text-foreground p-1 rounded-xl shadow-xl z-50">
								<DropdownMenuRadioGroup
									value={dmPermission}
									onValueChange={(val) => {
										const typed = val as 'everyone' | 'friends' | 'nobody';
										setDmPermission(typed);
										handleSave({ dm_permission: typed });
									}}
								>
									<DropdownMenuRadioItem value="everyone" className="rounded-lg py-2 cursor-pointer text-sm">
										Everyone (Anyone can message you)
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="friends" className="rounded-lg py-2 cursor-pointer text-sm">
										Friends Only (Only friends can initiate DMs)
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="nobody" className="rounded-lg py-2 cursor-pointer text-sm">
										Nobody (Disable direct messages)
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				{/* 3. Friend Request Permissions */}
				<div className="bg-card/60 border border-border/70 rounded-2xl p-5 shadow-sm hover:border-border transition flex flex-col gap-3">
					<div className="flex items-start gap-3">
						<div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
							<UserPlus size={18} />
						</div>
						<div className="flex-1">
							<span className="text-sm font-bold text-foreground block">
								Who can send me friend requests
							</span>
							<p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
								Control incoming friend invitations from other users on the platform.
							</p>
						</div>
					</div>

					<div className="mt-1">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="w-full bg-secondary/80 border border-border/80 hover:border-primary/60 text-foreground text-sm rounded-xl px-3.5 py-2.5 outline-none transition cursor-pointer font-medium flex items-center justify-between"
								>
									<span className="truncate">{friendRequestLabels[friendRequestPermission]}</span>
									<ChevronDown size={16} className="text-muted-foreground ms-2 shrink-0" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] bg-popover border-border text-foreground p-1 rounded-xl shadow-xl z-50">
								<DropdownMenuRadioGroup
									value={friendRequestPermission}
									onValueChange={(val) => {
										const typed = val as 'everyone' | 'nobody';
										setFriendRequestPermission(typed);
										handleSave({ friend_request_permission: typed });
									}}
								>
									<DropdownMenuRadioItem value="everyone" className="rounded-lg py-2 cursor-pointer text-sm">
										Everyone (Anyone can send friend requests)
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="nobody" className="rounded-lg py-2 cursor-pointer text-sm">
										Nobody (Disable incoming friend requests)
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</div>
		</div>
	);
};

export default PrivacyTab;
