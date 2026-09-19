import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
	Search,
	X,
	Hash,
	Compass,
	User,
	Plus,
	Loader2,
	CornerDownLeft,
} from 'lucide-react';
import {
	useAuthStore,
	useChannelStore,
	getChannelDisplayName,
} from '@/store/store';
import { isDirectMessage } from '@/utils/channel';
import { Avatar, ChannelInitialsAvatar } from '@/components/Avatar';
import { getFileUrl, apiJoinChannel } from '@/api/client';
import { useExploreChannels } from '@/hooks/useChannels';
import type { Channel } from '@/types/api';
import { isMac } from '@/utils/wails';

interface ConversationSearchDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateNew?: (tab: 'dm' | 'channel') => void;
}

type FilterTab = 'all' | 'dms' | 'channels' | 'explore';

export const ConversationSearchDialog: React.FC<ConversationSearchDialogProps> = ({
	open,
	onOpenChange,
	onCreateNew,
}) => {
	const user = useAuthStore((state) => state.user);
	const relationships = useAuthStore((state) => state.relationships);
	const channels = useChannelStore((state) => state.channels);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);

	const [search, setSearch] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isJoiningId, setIsJoiningId] = useState<string | null>(null);

	const inputRef = useRef<HTMLInputElement>(null);

	// Debounce search for remote exploration
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(search.trim());
		}, 300);
		return () => clearTimeout(timer);
	}, [search]);

	// Reset selected index on search or filter change
	useEffect(() => {
		setSelectedIndex(0);
	}, [search, activeFilter]);

	// Focus input on open
	useEffect(() => {
		if (open) {
			setSearch('');
			setDebouncedSearch('');
			setActiveFilter('all');
			setSelectedIndex(0);
			setTimeout(() => {
				inputRef.current?.focus();
			}, 50);
		}
	}, [open]);

	const { data: exploreChannels = [], isFetching: isExploring } =
		useExploreChannels(debouncedSearch);

	// Filter joined channels
	const filteredChannels = useMemo(() => {
		const q = search.toLowerCase().trim();
		return channels.filter((ch) => {
			const isDM = isDirectMessage(ch);
			if (activeFilter === 'dms' && !isDM) return false;
			if (activeFilter === 'channels' && isDM) return false;
			if (!q) return true;

			const name = getChannelDisplayName(ch, user?.id ?? '').toLowerCase();
			if (name.includes(q)) return true;
			if (ch.description && ch.description.toLowerCase().includes(q)) return true;
			return false;
		});
	}, [channels, search, activeFilter, user?.id]);

	// Split into DMs and Group channels
	const dms = useMemo(
		() => filteredChannels.filter((ch) => isDirectMessage(ch)),
		[filteredChannels],
	);
	const groupChannels = useMemo(
		() => filteredChannels.filter((ch) => !isDirectMessage(ch)),
		[filteredChannels],
	);

	// Filter explore channels (excluding those already joined)
	const publicExplore = useMemo(() => {
		if (activeFilter === 'dms') return [];
		const joinedIds = new Set(channels.map((c) => c.id));
		return exploreChannels.filter((ch) => !joinedIds.has(ch.id));
	}, [exploreChannels, channels, activeFilter]);

	// Flatten all visible items for arrow key navigation
	type FlattenedItem =
		| { type: 'channel'; data: Channel }
		| { type: 'explore'; data: any };

	const allItems: FlattenedItem[] = useMemo(() => {
		if (activeFilter === 'explore') {
			return publicExplore.map((ch) => ({ type: 'explore', data: ch }));
		}
		if (activeFilter === 'dms') {
			return dms.map((ch) => ({ type: 'channel', data: ch }));
		}
		if (activeFilter === 'channels') {
			return groupChannels.map((ch) => ({ type: 'channel', data: ch }));
		}
		// 'all'
		const list: FlattenedItem[] = [];
		dms.forEach((ch) => list.push({ type: 'channel', data: ch }));
		groupChannels.forEach((ch) => list.push({ type: 'channel', data: ch }));
		if (search.trim()) {
			publicExplore.forEach((ch) => list.push({ type: 'explore', data: ch }));
		}
		return list;
	}, [activeFilter, dms, groupChannels, publicExplore, search]);

	const handleSelectChannel = (ch: Channel) => {
		setActiveChannel(ch);
		onOpenChange(false);
	};

	const handleJoinExplore = async (ch: any) => {
		if (isJoiningId) return;
		try {
			setIsJoiningId(ch.id);
			await apiJoinChannel(ch.invite_link || ch.id);
			await useChannelStore.getState().refreshChannels();
			const active = useChannelStore
				.getState()
				.channels.find((c) => c.id === ch.id);
			if (active) {
				useChannelStore.getState().setActiveChannel(active);
			}
			onOpenChange(false);
		} catch (err) {
			console.error('Failed to join channel:', err);
		} finally {
			setIsJoiningId(null);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setSelectedIndex((prev) =>
				allItems.length > 0 ? (prev + 1) % allItems.length : 0,
			);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setSelectedIndex((prev) =>
				allItems.length > 0
					? (prev - 1 + allItems.length) % allItems.length
					: 0,
			);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const current = allItems[selectedIndex];
			if (current) {
				if (current.type === 'channel') {
					handleSelectChannel(current.data);
				} else if (current.type === 'explore') {
					handleJoinExplore(current.data);
				}
			}
		}
	};

	let currentIndexCounter = -1;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="p-0 gap-0 max-w-xl sm:max-w-2xl bg-card/95 backdrop-blur-xl border border-border/80 shadow-2xl overflow-hidden rounded-2xl sm:rounded-2xl top-[25%] sm:top-[30%]"
				onKeyDown={handleKeyDown}
			>
				<DialogTitle className="sr-only">Search Conversations</DialogTitle>

				{/* Top Search Input Bar */}
				<div className="flex items-center px-4 py-3.5 border-b border-border/60 gap-3 bg-secondary/30">
					<Search className="w-5 h-5 text-muted-foreground shrink-0" />
					<input
						ref={inputRef}
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search conversations, direct messages, or public channels..."
						className="flex-1 bg-transparent border-none outline-none shadow-none text-[15px] text-foreground placeholder:text-muted-foreground/70 p-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="none"
						spellCheck="false"
					/>
					{search && (
						<button
							type="button"
							onClick={() => setSearch('')}
							className="text-muted-foreground hover:text-foreground p-1 rounded-md transition"
						>
							<X className="w-4 h-4" />
						</button>
					)}
				</div>

				{/* Filter Tabs */}
				<div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/40 bg-secondary/15 text-xs">
					<button
						type="button"
						onClick={() => setActiveFilter('all')}
						className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
							activeFilter === 'all'
								? 'bg-primary text-primary-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
						}`}
					>
						<span>All</span>
						<span className="text-[10px] opacity-75">
							{channels.length}
						</span>
					</button>
					<button
						type="button"
						onClick={() => setActiveFilter('dms')}
						className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
							activeFilter === 'dms'
								? 'bg-primary text-primary-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
						}`}
					>
						<User className="w-3.5 h-3.5" />
						<span>Direct Messages</span>
						<span className="text-[10px] opacity-75">
							{channels.filter(isDirectMessage).length}
						</span>
					</button>
					<button
						type="button"
						onClick={() => setActiveFilter('channels')}
						className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
							activeFilter === 'channels'
								? 'bg-primary text-primary-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
						}`}
					>
						<Hash className="w-3.5 h-3.5" />
						<span>Channels</span>
						<span className="text-[10px] opacity-75">
							{channels.filter((c) => !isDirectMessage(c)).length}
						</span>
					</button>
					<button
						type="button"
						onClick={() => setActiveFilter('explore')}
						className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
							activeFilter === 'explore'
								? 'bg-primary text-primary-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
						}`}
					>
						<Compass className="w-3.5 h-3.5" />
						<span>Explore Public</span>
					</button>
				</div>

				{/* Results List */}
				<ScrollArea className="max-h-[380px] sm:max-h-[420px] overflow-y-auto px-2 py-2">
					{allItems.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 px-4 text-center">
							<div className="w-12 h-12 rounded-2xl bg-secondary/80 flex items-center justify-center text-muted-foreground mb-3">
								<Search className="w-6 h-6" />
							</div>
							<div className="text-sm font-semibold text-foreground">
								No conversations found
							</div>
							<p className="text-xs text-muted-foreground mt-1 max-w-xs">
								{search
									? `No matches found for "${search}". Try another query or explore public channels.`
									: 'You have no conversations in this category yet.'}
							</p>
							{onCreateNew && (
								<div className="flex items-center gap-2 mt-4">
									<button
										type="button"
										onClick={() => {
											onOpenChange(false);
											onCreateNew('dm');
										}}
										className="px-3 py-1.5 rounded-lg text-xs font-medium bg-secondary hover:bg-accent text-foreground transition cursor-pointer flex items-center gap-1.5"
									>
										<User className="w-3.5 h-3.5" />
										<span>New DM</span>
									</button>
									<button
										type="button"
										onClick={() => {
											onOpenChange(false);
											onCreateNew('channel');
										}}
										className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition cursor-pointer flex items-center gap-1.5"
									>
										<Plus className="w-3.5 h-3.5" />
										<span>New Channel</span>
									</button>
								</div>
							)}
						</div>
					) : (
						<div className="flex flex-col gap-1 pb-2">
							{/* Direct Messages Section */}
							{(activeFilter === 'all' || activeFilter === 'dms') &&
								dms.length > 0 && (
									<div className="mb-2">
										<div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
											Direct Messages
										</div>
										<div className="flex flex-col gap-0.5">
											{dms.map((ch) => {
												currentIndexCounter += 1;
												const thisIndex = currentIndexCounter;
												const isSelected = selectedIndex === thisIndex;
												const otherMemberId =
													ch.members.find((m) => m !== user?.id) ||
													ch.members[0] ||
													ch.id;
												const isBlocked = relationships.some(
													(r) =>
														r.to_user_id === otherMemberId &&
														r.type === 'blocked',
												);
												const display = getChannelDisplayName(
													ch,
													user?.id ?? '',
												);
												const status =
													ch.member_statuses?.[otherMemberId] || 'offline';

												return (
													<div
														key={ch.id}
														onClick={() => handleSelectChannel(ch)}
														onMouseEnter={() => setSelectedIndex(thisIndex)}
														className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition ${
															isSelected
																? 'bg-accent text-foreground'
																: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
														}`}
													>
														<div className="flex items-center gap-3 min-w-0">
															<div className="relative shrink-0">
																<Avatar
																	userId={otherMemberId}
																	avatarId={
																		ch.member_avatars?.[otherMemberId]
																	}
																	size={36}
																/>
																<div
																	className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${
																		status === 'online'
																			? 'bg-green-500'
																			: status === 'away'
																				? 'bg-yellow-500'
																				: status === 'dnd'
																					? 'bg-red-500'
																					: 'bg-zinc-500'
																	}`}
																/>
															</div>
															<div className="min-w-0">
																<div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
																	<span>{display}</span>
																	{isBlocked && (
																		<span className="text-[10px] text-destructive bg-destructive/10 px-1 rounded">
																			Blocked
																		</span>
																	)}
																</div>
																<div className="text-xs text-muted-foreground truncate capitalize">
																	{status}
																</div>
															</div>
														</div>

														<div className="flex items-center gap-2 shrink-0">
															{(ch.unread_count ?? 0) > 0 && (
																<span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-[#e05638] rounded-[5px] text-[11px] font-bold text-white">
																	{ch.unread_count}
																</span>
															)}
															{isSelected && (
																<CornerDownLeft className="w-4 h-4 text-muted-foreground/80" />
															)}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								)}

							{/* Group Channels Section */}
							{(activeFilter === 'all' || activeFilter === 'channels') &&
								groupChannels.length > 0 && (
									<div className="mb-2">
										<div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
											Channels
										</div>
										<div className="flex flex-col gap-0.5">
											{groupChannels.map((ch) => {
												currentIndexCounter += 1;
												const thisIndex = currentIndexCounter;
												const isSelected = selectedIndex === thisIndex;
												const display = ch.name;

												return (
													<div
														key={ch.id}
														onClick={() => handleSelectChannel(ch)}
														onMouseEnter={() => setSelectedIndex(thisIndex)}
														className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition ${
															isSelected
																? 'bg-accent text-foreground'
																: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
														}`}
													>
														<div className="flex items-center gap-3 min-w-0">
															<div className="shrink-0">
																{ch.avatar_id ? (
																	<div className="w-9 h-9 rounded-full overflow-hidden bg-secondary border border-border/40">
																		<img
																			src={getFileUrl(ch.avatar_id)}
																			alt={ch.name}
																			className="w-full h-full object-cover"
																		/>
																	</div>
																) : (
																	<ChannelInitialsAvatar
																		id={ch.id}
																		name={ch.name}
																		size={36}
																	/>
																)}
															</div>
															<div className="min-w-0">
																<div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
																	<Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
																	<span className="truncate">{display}</span>
																</div>
																<div className="text-xs text-muted-foreground truncate">
																	{ch.description ||
																		`${ch.members?.length ?? 0} members`}
																</div>
															</div>
														</div>

														<div className="flex items-center gap-2 shrink-0">
															{(ch.unread_count ?? 0) > 0 && (
																<span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-[#e05638] rounded-[5px] text-[11px] font-bold text-white">
																	{ch.unread_count}
																</span>
															)}
															{isSelected && (
																<CornerDownLeft className="w-4 h-4 text-muted-foreground/80" />
															)}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								)}

							{/* Public Channels / Explore Section */}
							{(activeFilter === 'all' || activeFilter === 'explore') &&
								(publicExplore.length > 0 || isExploring) && (
									<div className="mb-2">
										<div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
											<span>Public Channels</span>
											{isExploring && (
												<Loader2 className="w-3 h-3 animate-spin text-primary" />
											)}
										</div>
										<div className="flex flex-col gap-0.5">
											{publicExplore.map((ch: any) => {
												currentIndexCounter += 1;
												const thisIndex = currentIndexCounter;
												const isSelected = selectedIndex === thisIndex;

												return (
													<div
														key={ch.id}
														onClick={() => handleJoinExplore(ch)}
														onMouseEnter={() => setSelectedIndex(thisIndex)}
														className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition ${
															isSelected
																? 'bg-accent text-foreground'
																: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
														}`}
													>
														<div className="flex items-center gap-3 min-w-0">
															<div className="shrink-0">
																{ch.avatar_id ? (
																	<div className="w-9 h-9 rounded-full overflow-hidden bg-secondary border border-border/40">
																		<img
																			src={getFileUrl(ch.avatar_id)}
																			alt={ch.name}
																			className="w-full h-full object-cover"
																		/>
																	</div>
																) : (
																	<ChannelInitialsAvatar
																		id={ch.id}
																		name={ch.name}
																		size={36}
																	/>
																)}
															</div>
															<div className="min-w-0">
																<div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
																	<Compass className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
																	<span className="truncate">{ch.name}</span>
																</div>
																<div className="text-xs text-muted-foreground truncate">
																	{ch.description ||
																		`${ch.member_count ?? 0} members`}
																</div>
															</div>
														</div>

														<div className="flex items-center gap-2 shrink-0">
															<button
																type="button"
																disabled={isJoiningId === ch.id}
																onClick={(e) => {
																	e.stopPropagation();
																	handleJoinExplore(ch);
																}}
																className="h-7 px-2.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
															>
																{isJoiningId === ch.id ? (
																	<Loader2 className="w-3 h-3 animate-spin" />
																) : (
																	'Join'
																)}
															</button>
														</div>
													</div>
												);
											})}
										</div>
									</div>
								)}
						</div>
					)}
				</ScrollArea>

				{/* Footer Shortcuts */}
				<div className="px-4 py-2 border-t border-border/40 bg-secondary/30 flex items-center justify-between text-[11px] text-muted-foreground">
					<div className="flex items-center gap-3">
						<span className="flex items-center gap-1">
							<kbd className="pointer-events-none select-none h-5 px-1.5 font-mono text-[10px] font-medium text-muted-foreground bg-muted border border-border/60 rounded flex items-center justify-center">
								↑
							</kbd>
							<kbd className="pointer-events-none select-none h-5 px-1.5 font-mono text-[10px] font-medium text-muted-foreground bg-muted border border-border/60 rounded flex items-center justify-center">
								↓
							</kbd>
							<span>navigate</span>
						</span>
						<span className="flex items-center gap-1">
							<kbd className="pointer-events-none select-none h-5 px-1.5 font-mono text-[10px] font-medium text-muted-foreground bg-muted border border-border/60 rounded flex items-center justify-center">
								↵
							</kbd>
							<span>select</span>
						</span>
						<span className="flex items-center gap-1">
							<kbd className="pointer-events-none select-none h-5 px-1.5 font-mono text-[10px] font-medium text-muted-foreground bg-muted border border-border/60 rounded flex items-center justify-center">
								esc
							</kbd>
							<span>close</span>
						</span>
					</div>
					<div className="hidden sm:flex items-center gap-1.5 text-[10px] text-muted-foreground/80 font-mono">
						<span>Shortcut:</span>
						<kbd className="pointer-events-none select-none h-4.5 px-1.5 font-mono text-[9.5px] font-medium text-muted-foreground bg-muted border border-border/60 rounded">
							{isMac() ? '⌘K' : 'Ctrl+K'}
						</kbd>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};
