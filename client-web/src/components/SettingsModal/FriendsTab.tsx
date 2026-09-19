import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/store';
import { useChannelStore } from '@/store/channels.slice';
import { Avatar as MinidenticonAvatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	Users,
	UserPlus,
	Clock,
	ShieldAlert,
	MessageSquare,
	UserMinus,
	Check,
	X,
	Search,
	Loader2,
} from 'lucide-react';
import { apiSearchUsers } from '@/api/client';
import { useUserSearch } from '@/hooks/useUsers';

export const FriendsTab = ({ onCloseModal }: { onCloseModal?: () => void }) => {
	const user = useAuthStore((state) => state.user);
	const relationships = useAuthStore((state) => state.relationships);
	const incomingRequests = useAuthStore((state) => state.incomingRequests);
	const relationshipAction = useAuthStore((state) => state.relationshipAction);
	const createChannel = useChannelStore((state) => state.createChannel);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);
	const channels = useChannelStore((state) => state.channels);

	const [activeSubTab, setActiveSubTab] = useState<'friends' | 'pending' | 'sent' | 'blocked'>('friends');
	const [searchQuery, setSearchQuery] = useState('');
	const [addUsername, setAddUsername] = useState('');
	const [debouncedAddUsername, setDebouncedAddUsername] = useState('');
	const [isAdding, setIsAdding] = useState(false);
	const [addStatus, setAddStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
	const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

	useEffect(() => {
		const handler = setTimeout(() => {
			setDebouncedAddUsername(addUsername.trim());
		}, 300);
		return () => clearTimeout(handler);
	}, [addUsername]);

	const { data: searchedUsers = [], isFetching: isSearchingUsers } = useUserSearch(
		debouncedAddUsername,
		user?.username,
	);

	const friends = relationships.filter((r) => r.type === 'friend');
	const sentRequests = relationships.filter((r) => r.type === 'requested');
	const blockedUsers = relationships.filter((r) => r.type === 'blocked');

	const filteredFriends = friends.filter((f) =>
		f.user?.username?.toLowerCase().includes(searchQuery.toLowerCase()),
	);

	const handleSendRequestToUser = async (targetUserId: string, targetUsername: string) => {
		setIsAdding(true);
		setAddStatus(null);
		try {
			await relationshipAction(targetUserId, 'request');
			setAddStatus({
				type: 'success',
				message: `Friend request sent to ${targetUsername}!`,
			});
		} catch (err: any) {
			const msg =
				err?.response?.data?.error || err?.message || 'Failed to send request.';
			setAddStatus({ type: 'error', message: msg });
		} finally {
			setIsAdding(false);
		}
	};

	const handleSendRequest = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = addUsername.trim();
		if (!trimmed) return;
		if (trimmed.toLowerCase() === user?.username.toLowerCase()) {
			setAddStatus({ type: 'error', message: 'You cannot friend yourself.' });
			return;
		}

		// If we already have search results, use the first matching one
		const firstMatch = searchedUsers.find(
			(u) => u.username.toLowerCase() === trimmed.toLowerCase(),
		) || searchedUsers[0];

		if (firstMatch) {
			handleSendRequestToUser(firstMatch.id, firstMatch.username);
			return;
		}

		setIsAdding(true);
		setAddStatus(null);
		try {
			const found = await apiSearchUsers(trimmed);
			const target = found.find(
				(u) => u.username.toLowerCase() === trimmed.toLowerCase(),
			);
			if (!target) {
				setAddStatus({ type: 'error', message: `User "${trimmed}" not found.` });
				setIsAdding(false);
				return;
			}

			await relationshipAction(target.id, 'request');
			setAddStatus({
				type: 'success',
				message: `Friend request sent to ${target.username}!`,
			});
			setAddUsername('');
		} catch (err: any) {
			const msg =
				err?.response?.data?.error || err?.message || 'Failed to send request.';
			setAddStatus({ type: 'error', message: msg });
		} finally {
			setIsAdding(false);
		}
	};

	const handleAction = async (targetUserId: string, action: any) => {
		setActionLoadingId(targetUserId);
		try {
			await relationshipAction(targetUserId, action);
		} catch (err) {
			console.error(`Failed to perform ${action}`, err);
		} finally {
			setActionLoadingId(null);
		}
	};

	const handleStartDM = async (friendUserId: string) => {
		try {
			// Check if DM channel already exists
			const existingDM = channels.find((c) => {
				if (c.name !== '') return false;
				return c.members.includes(friendUserId) && c.members.length === 2;
			});

			if (existingDM) {
				setActiveChannel(existingDM);
			} else {
				const newCh = await createChannel('', [friendUserId], true);
				setActiveChannel(newCh);
			}
			if (onCloseModal) onCloseModal();
		} catch (err) {
			console.error('Failed to open DM', err);
		}
	};

	return (
		<div className="w-full max-w-[540px] mx-auto animate-in fade-in slide-in-from-right-4 duration-300 pb-8">
			{/* Add Friend Banner */}
			<div className="bg-gradient-to-r from-indigo-950/60 to-purple-950/40 border border-indigo-500/20 rounded-2xl p-4 mb-6 shadow-sm">
				<h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-1">
					<UserPlus className="w-4 h-4 text-indigo-400" />
					Add Friend
				</h3>
				<p className="text-xs text-muted-foreground mb-3">
					Search and preview user profiles before sending a friend request.
				</p>
				<form onSubmit={handleSendRequest} className="relative flex gap-2">
					<div className="relative flex-1">
						<Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
						<Input
							value={addUsername}
							onChange={(e) => {
								setAddUsername(e.target.value);
								if (addStatus) setAddStatus(null);
							}}
							placeholder="Type username to search & preview..."
							className="pl-9 pr-8 bg-black/40 border-border/80 text-foreground text-sm rounded-xl h-9.5 focus:border-indigo-500"
						/>
						{isSearchingUsers ? (
							<Loader2 className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-indigo-400" />
						) : addUsername ? (
							<button
								type="button"
								onClick={() => {
									setAddUsername('');
									setAddStatus(null);
								}}
								className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer flex items-center justify-center"
							>
								<X size={14} />
							</button>
						) : null}
					</div>
					<Button
						type="submit"
						disabled={isAdding || !addUsername.trim()}
						className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-4 h-9.5 rounded-xl shrink-0 cursor-pointer shadow-md shadow-indigo-600/20"
					>
						{isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Request'}
					</Button>
				</form>

				{/* Live User Search & Preview Cards */}
				{debouncedAddUsername && (
					<div className="mt-3 flex flex-col gap-2">
						{isSearchingUsers && searchedUsers.length === 0 ? (
							<div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
								<Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
								<span>Searching user directory...</span>
							</div>
						) : searchedUsers.length > 0 ? (
							<div className="flex flex-col gap-1.5 bg-black/30 border border-indigo-500/15 rounded-xl p-2 max-h-48 overflow-y-auto">
								<div className="text-[11px] font-semibold text-indigo-300/80 px-2 py-0.5 uppercase tracking-wider">
									Found Users
								</div>
								{searchedUsers.map((targetUser) => {
									const isTargetFriend = relationships.some(
										(r) => r.to_user_id === targetUser.id && r.type === 'friend',
									);
									const isTargetRequested = relationships.some(
										(r) => r.to_user_id === targetUser.id && r.type === 'requested',
									);
									const isTargetIncoming = incomingRequests.some(
										(r) => r.from_user_id === targetUser.id,
									);
									const isTargetBlocked = relationships.some(
										(r) => r.to_user_id === targetUser.id && r.type === 'blocked',
									);

									return (
										<div
											key={targetUser.id}
											className="flex items-center justify-between p-2 rounded-lg bg-card/60 border border-border/40 hover:border-indigo-500/40 transition"
										>
											<div className="flex items-center gap-2.5 min-w-0">
												<div className="relative shrink-0">
													<MinidenticonAvatar
														userId={targetUser.id}
														avatarId={targetUser.avatar_id}
														size={36}
													/>
													<div
														className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
															targetUser.status === 'online'
																? 'bg-emerald-500'
																: targetUser.status === 'away'
																	? 'bg-amber-500'
																	: 'bg-zinc-600'
														}`}
													/>
												</div>
												<div className="min-w-0">
													<div className="text-xs font-bold text-foreground truncate">
														{targetUser.username}
													</div>
													<div className="text-[11px] text-muted-foreground truncate">
														~{targetUser.domain || 'localhost'}
														{targetUser.custom_msg && ` • "${targetUser.custom_msg}"`}
													</div>
												</div>
											</div>

											<div className="shrink-0 ml-2">
												{isTargetFriend ? (
													<span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/40 px-2 py-1 rounded-md border border-emerald-500/20">
														<Check size={12} />
														<span>Friends</span>
													</span>
												) : isTargetRequested ? (
													<span className="flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-950/40 px-2 py-1 rounded-md border border-amber-500/20">
														<Clock size={12} />
														<span>Pending</span>
													</span>
												) : isTargetIncoming ? (
													<Button
														type="button"
														size="sm"
														disabled={isAdding}
														onClick={() => handleAction(targetUser.id, 'accept')}
														className="h-7 px-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white gap-1 cursor-pointer"
													>
														<Check size={12} />
														<span>Accept</span>
													</Button>
												) : isTargetBlocked ? (
													<span className="text-[11px] text-destructive bg-destructive/10 px-2 py-1 rounded-md">
														Blocked
													</span>
												) : (
													<Button
														type="button"
														size="sm"
														disabled={isAdding}
														onClick={() =>
															handleSendRequestToUser(targetUser.id, targetUser.username)
														}
														className="h-7 px-2.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white gap-1 cursor-pointer shadow-sm"
													>
														{isAdding ? (
															<Loader2 size={12} className="animate-spin" />
														) : (
															<UserPlus size={12} />
														)}
														<span>Add Friend</span>
													</Button>
												)}
											</div>
										</div>
									);
								})}
							</div>
						) : (
							<div className="text-center py-3 text-xs text-muted-foreground">
								No user found with username "{debouncedAddUsername}".
							</div>
						)}
					</div>
				)}

				{addStatus && (
					<p
						className={`text-xs mt-2.5 font-medium flex items-center gap-1.5 ${
							addStatus.type === 'success' ? 'text-emerald-400' : 'text-red-400'
						}`}
					>
						{addStatus.type === 'success' ? <Check size={14} /> : <X size={14} />}
						{addStatus.message}
					</p>
				)}
			</div>

			{/* Sub Navigation Tabs */}
			<div className="flex items-center gap-1.5 p-1 bg-secondary/70 border border-border/60 rounded-xl mb-4 text-xs font-medium">
				<button
					type="button"
					onClick={() => setActiveSubTab('friends')}
					className={`flex-1 py-1.5 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
						activeSubTab === 'friends'
							? 'bg-background text-foreground shadow-sm font-semibold'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					<Users size={14} />
					<span>Friends</span>
					<span className="text-[10px] px-1.5 py-0.2 rounded-full bg-secondary text-muted-foreground font-mono">
						{friends.length}
					</span>
				</button>

				<button
					type="button"
					onClick={() => setActiveSubTab('pending')}
					className={`flex-1 py-1.5 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer relative ${
						activeSubTab === 'pending'
							? 'bg-background text-foreground shadow-sm font-semibold'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					<Clock size={14} />
					<span>Pending</span>
					{incomingRequests.length > 0 && (
						<span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-600 text-white font-mono font-bold animate-pulse">
							{incomingRequests.length}
						</span>
					)}
				</button>

				<button
					type="button"
					onClick={() => setActiveSubTab('sent')}
					className={`flex-1 py-1.5 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
						activeSubTab === 'sent'
							? 'bg-background text-foreground shadow-sm font-semibold'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					<UserPlus size={14} />
					<span>Sent</span>
					<span className="text-[10px] px-1.5 py-0.2 rounded-full bg-secondary text-muted-foreground font-mono">
						{sentRequests.length}
					</span>
				</button>

				<button
					type="button"
					onClick={() => setActiveSubTab('blocked')}
					className={`flex-1 py-1.5 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
						activeSubTab === 'blocked'
							? 'bg-background text-foreground shadow-sm font-semibold'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					<ShieldAlert size={14} />
					<span>Blocked</span>
					<span className="text-[10px] px-1.5 py-0.2 rounded-full bg-secondary text-muted-foreground font-mono">
						{blockedUsers.length}
					</span>
				</button>
			</div>

			{/* Sub-Tab Content */}
			{activeSubTab === 'friends' && (
				<div className="flex flex-col gap-3">
					<div className="relative">
						<Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search friends..."
							className="pl-9 bg-card border-border/80 text-foreground text-xs rounded-xl h-9"
						/>
					</div>

					{filteredFriends.length === 0 ? (
						<div className="text-center py-10 text-muted-foreground text-xs">
							{searchQuery ? 'No friends match your search.' : 'You have no friends added yet.'}
						</div>
					) : (
						<div className="flex flex-col gap-2">
							{filteredFriends.map((f) => (
								<div
									key={f.to_user_id}
									className="flex items-center justify-between p-3 rounded-xl bg-card/60 border border-border/60 hover:border-border transition group"
								>
									<div className="flex items-center gap-3">
										<div className="relative">
											<MinidenticonAvatar
												userId={f.to_user_id}
												avatarId={f.user?.avatar_id}
												size={40}
											/>
											<div
												className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card ${
													f.user?.status === 'online'
														? 'bg-emerald-500'
														: f.user?.status === 'away'
														? 'bg-amber-500'
														: 'bg-zinc-600'
												}`}
											/>
										</div>
										<div>
											<div className="text-sm font-bold text-foreground">
												{f.user?.username || 'Unknown User'}
											</div>
											<div className="text-xs text-muted-foreground">
												~{f.user?.domain || 'localhost'}
												{f.user?.custom_msg && ` • "${f.user.custom_msg}"`}
											</div>
										</div>
									</div>

									<div className="flex items-center gap-1.5">
										<Button
											type="button"
											variant="secondary"
											size="sm"
											onClick={() => handleStartDM(f.to_user_id)}
											className="h-8 px-2.5 rounded-lg text-xs gap-1.5 cursor-pointer hover:bg-indigo-600 hover:text-white transition"
											title="Direct Message"
										>
											<MessageSquare size={13} />
											<span className="hidden sm:inline">Message</span>
										</Button>

										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={actionLoadingId === f.to_user_id}
											onClick={() => handleAction(f.to_user_id, 'remove')}
											className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-950/30 cursor-pointer"
											title="Remove Friend"
										>
											<UserMinus size={14} />
										</Button>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{activeSubTab === 'pending' && (
				<div className="flex flex-col gap-2">
					{incomingRequests.length === 0 ? (
						<div className="text-center py-10 text-muted-foreground text-xs">
							No pending friend requests.
						</div>
					) : (
						incomingRequests.map((req) => (
							<div
								key={req.from_user_id}
								className="flex items-center justify-between p-3 rounded-xl bg-card/60 border border-border/60 hover:border-border transition"
							>
								<div className="flex items-center gap-3">
									<MinidenticonAvatar
										userId={req.from_user_id}
										avatarId={req.user?.avatar_id}
										size={40}
									/>
									<div>
										<div className="text-sm font-bold text-foreground">
											{req.user?.username || 'Unknown User'}
										</div>
										<div className="text-xs text-muted-foreground">
											Incoming Friend Request • ~{req.user?.domain || 'localhost'}
										</div>
									</div>
								</div>

								<div className="flex items-center gap-1.5">
									<Button
										type="button"
										size="sm"
										disabled={actionLoadingId === req.from_user_id}
										onClick={() => handleAction(req.from_user_id, 'accept')}
										className="h-8 px-3 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white gap-1 cursor-pointer"
									>
										<Check size={13} />
										<span>Accept</span>
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={actionLoadingId === req.from_user_id}
										onClick={() => handleAction(req.from_user_id, 'decline')}
										className="h-8 px-2.5 rounded-lg text-xs text-muted-foreground hover:text-red-400 hover:bg-red-950/30 cursor-pointer"
									>
										<X size={13} />
										<span>Decline</span>
									</Button>
								</div>
							</div>
						))
					)}
				</div>
			)}

			{activeSubTab === 'sent' && (
				<div className="flex flex-col gap-2">
					{sentRequests.length === 0 ? (
						<div className="text-center py-10 text-muted-foreground text-xs">
							You have not sent any pending friend requests.
						</div>
					) : (
						sentRequests.map((req) => (
							<div
								key={req.to_user_id}
								className="flex items-center justify-between p-3 rounded-xl bg-card/60 border border-border/60 hover:border-border transition"
							>
								<div className="flex items-center gap-3">
									<MinidenticonAvatar
										userId={req.to_user_id}
										avatarId={req.user?.avatar_id}
										size={40}
									/>
									<div>
										<div className="text-sm font-bold text-foreground">
											{req.user?.username || 'Unknown User'}
										</div>
										<div className="text-xs text-muted-foreground">
											Pending Response • ~{req.user?.domain || 'localhost'}
										</div>
									</div>
								</div>

								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={actionLoadingId === req.to_user_id}
									onClick={() => handleAction(req.to_user_id, 'cancel')}
									className="h-8 px-3 rounded-lg text-xs text-muted-foreground hover:text-red-400 hover:bg-red-950/30 cursor-pointer"
								>
									Cancel Request
								</Button>
							</div>
						))
					)}
				</div>
			)}

			{activeSubTab === 'blocked' && (
				<div className="flex flex-col gap-2">
					{blockedUsers.length === 0 ? (
						<div className="text-center py-10 text-muted-foreground text-xs">
							You have no blocked users.
						</div>
					) : (
						blockedUsers.map((b) => (
							<div
								key={b.to_user_id}
								className="flex items-center justify-between p-3 rounded-xl bg-card/60 border border-border/60 hover:border-border transition"
							>
								<div className="flex items-center gap-3">
									<MinidenticonAvatar
										userId={b.to_user_id}
										avatarId={b.user?.avatar_id}
										size={40}
									/>
									<div>
										<div className="text-sm font-bold text-foreground">
											{b.user?.username || 'Blocked User'}
										</div>
										<div className="text-xs text-muted-foreground">
											Blocked from sending you messages
										</div>
									</div>
								</div>

								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={actionLoadingId === b.to_user_id}
									onClick={() => handleAction(b.to_user_id, 'unblock')}
									className="h-8 px-3 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 cursor-pointer"
								>
									Unblock
								</Button>
							</div>
						))
					)}
				</div>
			)}
		</div>
	);
};

export default FriendsTab;
