import React from 'react';
import { useTranslation } from 'react-i18next';
import { Compass, Hash, Loader2, Plus, Search, User, X } from 'lucide-react';

import { Avatar, ChannelAvatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { ModalShell } from '@/components/modal-shell';
import { StatusDot } from '@/domains/users/components/status-dot';
import { normalizeStatus } from '@/domains/users/utils/status';
import { useAuthStore, getChannelDisplayName } from '@/store/store';
import { isMac } from '@/utils/wails';
import { cn } from '@/lib/utils';
import type { Channel } from '@/types/api';
import { useConversationSearch } from '../hooks/use-conversation-search';
import type { SearchFilter } from '../utils/conversation-search';
import { KeyCap, SearchRow, SearchSectionTitle, UnreadBadge } from './search-rows';

interface ConversationSearchDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Offers "New DM" / "New channel" buttons when nothing matches. */
	onCreateNew?: (tab: 'dm' | 'channel') => void;
}

/**
 * Command-palette style search over the user's conversations and public
 * channels (Ctrl/Cmd+K), with arrow-key navigation.
 */
export const ConversationSearchDialog: React.FC<ConversationSearchDialogProps> = ({
	open,
	onOpenChange,
	onCreateNew,
}) => {
	const { t } = useTranslation();

	return (
		<ModalShell
			open={open}
			onOpenChange={onOpenChange}
			title={t('search.title')}
			size="lg"
			chromeless
			className="top-[25%] sm:top-[30%]"
			bodyClassName="max-h-none overflow-visible"
		>
			{/* Mounted only while open, so query and selection reset on every open. */}
			<SearchPanel onClose={() => onOpenChange(false)} onCreateNew={onCreateNew} />
		</ModalShell>
	);
};

const FILTERS: { id: SearchFilter; labelKey: string; icon?: React.ElementType }[] = [
	{ id: 'all', labelKey: 'search.filter_all' },
	{ id: 'dms', labelKey: 'search.filter_dms', icon: User },
	{ id: 'channels', labelKey: 'search.filter_channels', icon: Hash },
	{ id: 'explore', labelKey: 'search.filter_explore', icon: Compass },
];

const SearchPanel = ({
	onClose,
	onCreateNew,
}: {
	onClose: () => void;
	onCreateNew?: (tab: 'dm' | 'channel') => void;
}) => {
	const { t } = useTranslation();
	const user = useAuthStore((s) => s.user);
	const relationships = useAuthStore((s) => s.relationships);
	const s = useConversationSearch(onClose);
	const { dms, groupChannels, publicChannels, items } = s.sections;

	// Position of each row in the flattened list, so keyboard selection matches what is on screen.
	const indexOf = (type: 'channel' | 'explore', id: string) =>
		items.findIndex((it) => it.type === type && it.channel.id === id);

	const counts: Record<SearchFilter, number | null> = { ...s.counts, explore: null };

	const newEntry = (tab: 'dm' | 'channel') => {
		onClose();
		onCreateNew?.(tab);
	};

	const shortcut = isMac() ? '⌘K' : 'Ctrl+K';

	return (
		<div onKeyDown={s.handleKeyDown}>
			<div className="flex items-center gap-3 border-b border-border/60 bg-secondary/30 px-4 py-3.5">
				<Search className="h-5 w-5 shrink-0 text-muted-foreground" />
				<input
					autoFocus
					type="text"
					value={s.search}
					onChange={(e) => s.setSearch(e.target.value)}
					placeholder={t('search.placeholder')}
					aria-label={t('search.placeholder')}
					className="flex-1 border-none bg-transparent p-0 text-[15px] text-foreground shadow-none outline-none placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="none"
					spellCheck={false}
				/>
				{s.search && (
					<IconButton label={t('friends.clear')} onClick={() => s.setSearch('')} className="h-7 w-7">
						<X className="h-4 w-4" />
					</IconButton>
				)}
			</div>

			<div className="flex items-center gap-1.5 border-b border-border/40 bg-secondary/15 px-4 py-2 text-xs" role="tablist">
				{FILTERS.map(({ id, labelKey, icon: Icon }) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={s.filter === id}
						onClick={() => s.setFilter(id)}
						className={cn(
							'flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1 font-medium transition',
							s.filter === id
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
						)}
					>
						{Icon && <Icon className="h-3.5 w-3.5" />}
						<span>{t(labelKey)}</span>
						{counts[id] !== null && <span className="text-[10px] opacity-75">{counts[id]}</span>}
					</button>
				))}
			</div>

			<ScrollArea className="max-h-[380px] overflow-y-auto px-2 py-2 sm:max-h-[420px]">
				{items.length === 0 ? (
					<EmptyState
						icon={<Search />}
						title={t('search.empty_title')}
						description={s.search ? t('search.empty_query', { query: s.search }) : t('search.empty_category')}
						action={
							onCreateNew && (
								<div className="flex items-center gap-2">
									<Button type="button" variant="secondary" size="sm" onClick={() => newEntry('dm')} className="gap-1.5">
										<User className="h-3.5 w-3.5" />
										{t('search.new_dm')}
									</Button>
									<Button type="button" size="sm" onClick={() => newEntry('channel')} className="gap-1.5">
										<Plus className="h-3.5 w-3.5" />
										{t('search.new_channel')}
									</Button>
								</div>
							)
						}
					/>
				) : (
					<div className="flex flex-col gap-1 pb-2">
						{(s.filter === 'all' || s.filter === 'dms') && dms.length > 0 && (
							<Section title={t('search.section_dms')}>
								{dms.map((ch) => {
									const index = indexOf('channel', ch.id);
									const otherId = ch.members.find((m) => m !== user?.id) || ch.members[0] || ch.id;
									const status = ch.member_statuses?.[otherId] || 'offline';
									const blocked = relationships.some((r) => r.to_user_id === otherId && r.type === 'blocked');
									return (
										<SearchRow
											key={ch.id}
											selected={s.selectedIndex === index}
											onClick={() => s.openChannel(ch)}
											onHover={() => s.setSelectedIndex(index)}
											leading={
												<>
													<Avatar userId={otherId} avatarId={ch.member_avatars?.[otherId]} size={36} />
													<StatusDot
														status={status}
														className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 border-2 border-background"
													/>
												</>
											}
											title={
												<>
													{getChannelDisplayName(ch, user?.id ?? '')}
													{blocked && (
														<span className="ms-1.5 rounded bg-destructive/10 px-1 text-[10px] text-destructive">
															{t('sidebar.blocked')}
														</span>
													)}
												</>
											}
											subtitle={t(`status.${normalizeStatus(status)}`)}
											trailing={(ch.unread_count ?? 0) > 0 && <UnreadBadge count={ch.unread_count ?? 0} />}
										/>
									);
								})}
							</Section>
						)}

						{(s.filter === 'all' || s.filter === 'channels') && groupChannels.length > 0 && (
							<Section title={t('search.section_channels')}>
								{groupChannels.map((ch: Channel) => {
									const index = indexOf('channel', ch.id);
									return (
										<SearchRow
											key={ch.id}
											selected={s.selectedIndex === index}
											onClick={() => s.openChannel(ch)}
											onHover={() => s.setSelectedIndex(index)}
											leading={<ChannelAvatar id={ch.id} name={ch.name} avatarId={ch.avatar_id} size={36} />}
											titleIcon={<Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
											title={ch.name}
											subtitle={ch.description || t('sidebar.members_count', { count: ch.members?.length ?? 0 })}
											trailing={(ch.unread_count ?? 0) > 0 && <UnreadBadge count={ch.unread_count ?? 0} />}
										/>
									);
								})}
							</Section>
						)}

						{(s.filter === 'all' || s.filter === 'explore') && (publicChannels.length > 0 || s.isExploring) && (
							<Section
								title={t('search.section_public')}
								aside={s.isExploring && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
							>
								{publicChannels.map((ch) => {
									const index = indexOf('explore', ch.id);
									return (
										<SearchRow
											key={ch.id}
											selected={s.selectedIndex === index}
											onClick={() => s.joinChannel(ch)}
											onHover={() => s.setSelectedIndex(index)}
											leading={<ChannelAvatar id={ch.id} name={ch.name} avatarId={ch.avatar_id} size={36} />}
											titleIcon={<Compass className="h-3.5 w-3.5 shrink-0 text-primary" />}
											title={ch.name}
											subtitle={ch.description || t('sidebar.members_count', { count: ch.member_count ?? 0 })}
											trailing={
												<Button
													type="button"
													size="sm"
													disabled={s.joiningId === ch.id}
													onClick={(e) => {
														e.stopPropagation();
														s.joinChannel(ch);
													}}
													className="h-7 px-2.5 text-xs"
												>
													{s.joiningId === ch.id ? (
														<Loader2 className="h-3 w-3 animate-spin" />
													) : (
														t('sidebar.join')
													)}
												</Button>
											}
										/>
									);
								})}
							</Section>
						)}
					</div>
				)}
			</ScrollArea>

			<div className="flex items-center justify-between border-t border-border/40 bg-secondary/30 px-4 py-2 text-[11px] text-muted-foreground">
				<div className="flex items-center gap-3">
					<span className="flex items-center gap-1">
						<KeyCap>↑</KeyCap>
						<KeyCap>↓</KeyCap>
						<span>{t('search.hint_navigate')}</span>
					</span>
					<span className="flex items-center gap-1">
						<KeyCap>↵</KeyCap>
						<span>{t('search.hint_select')}</span>
					</span>
					<span className="flex items-center gap-1">
						<KeyCap>esc</KeyCap>
						<span>{t('search.hint_close')}</span>
					</span>
				</div>
				<div className="hidden items-center gap-1.5 font-mono text-[10px] text-muted-foreground/80 sm:flex">
					<span>{t('search.shortcut')}</span>
					<KeyCap>{shortcut}</KeyCap>
				</div>
			</div>
		</div>
	);
};

const Section = ({
	title,
	aside,
	children,
}: {
	title: string;
	aside?: React.ReactNode;
	children: React.ReactNode;
}) => (
	<div className="mb-2">
		<SearchSectionTitle>
			<span>{title}</span>
			{aside}
		</SearchSectionTitle>
		<div className="flex flex-col gap-0.5">{children}</div>
	</div>
);
