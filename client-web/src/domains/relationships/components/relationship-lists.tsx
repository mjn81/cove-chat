import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, MessageSquare, Search, UserMinus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import type { RelationshipAction, RelationshipResponse } from '@/types/api';
import { RelationshipCard } from './relationship-card';

interface ListProps {
	items: RelationshipResponse[];
	/** User currently being acted on; that row's buttons are disabled. */
	loadingId: string | null;
	onAction: (userId: string, action: RelationshipAction) => void;
}

/** Accepted friends with a search box, message and remove buttons. */
export const FriendsList = ({
	items,
	loadingId,
	onAction,
	onMessage,
}: ListProps & { onMessage: (userId: string) => void }) => {
	const { t } = useTranslation();
	const [query, setQuery] = useState('');
	const filtered = items.filter((f) =>
		f.user?.username?.toLowerCase().includes(query.toLowerCase()),
	);

	return (
		<div className="flex flex-col gap-3">
			<div className="relative">
				<Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t('friends.search_friends')}
					aria-label={t('friends.search_friends')}
					className="h-9 ps-9 text-xs"
					autoComplete="off"
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
				/>
			</div>

			{filtered.length === 0 ? (
				<EmptyState title={query ? t('friends.no_match') : t('friends.no_friends')} />
			) : (
				<div className="flex flex-col gap-2">
					{filtered.map((f) => (
						<RelationshipCard
							key={f.to_user_id}
							userId={f.to_user_id}
							avatarId={f.user?.avatar_id}
							name={f.user?.username || t('friends.unknown_user')}
							subtitle={`~${f.user?.domain || 'localhost'}${f.user?.custom_msg ? ` • "${f.user.custom_msg}"` : ''}`}
							status={f.user?.status}
							actions={
								<>
									<Button
										type="button"
										variant="secondary"
										size="sm"
										onClick={() => onMessage(f.to_user_id)}
										className="h-8 gap-1.5 rounded-lg px-2.5 text-xs hover:bg-primary hover:text-primary-foreground"
										title={t('friends.dm_title')}
									>
										<MessageSquare size={13} />
										<span className="hidden sm:inline">{t('friends.message')}</span>
									</Button>
									<IconButton
										label={t('friends.remove_friend')}
										tone="destructive"
										disabled={loadingId === f.to_user_id}
										onClick={() => onAction(f.to_user_id, 'remove')}
									>
										<UserMinus size={14} />
									</IconButton>
								</>
							}
						/>
					))}
				</div>
			)}
		</div>
	);
};

/** Friend requests sent to the current user, with accept / decline. */
export const PendingRequests = ({ items, loadingId, onAction }: ListProps) => {
	const { t } = useTranslation();
	if (items.length === 0) return <EmptyState title={t('friends.no_pending')} />;

	return (
		<div className="flex flex-col gap-2">
			{items.map((req) => (
				<RelationshipCard
					key={req.from_user_id}
					userId={req.from_user_id}
					avatarId={req.user?.avatar_id}
					name={req.user?.username || t('friends.unknown_user')}
					subtitle={`${t('friends.incoming')} • ~${req.user?.domain || 'localhost'}`}
					actions={
						<>
							<Button
								type="button"
								size="sm"
								disabled={loadingId === req.from_user_id}
								onClick={() => onAction(req.from_user_id, 'accept')}
								className="h-8 gap-1 rounded-lg bg-success px-3 text-xs font-semibold text-success-foreground hover:bg-success/90"
							>
								<Check size={13} />
								<span>{t('friends.accept')}</span>
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={loadingId === req.from_user_id}
								onClick={() => onAction(req.from_user_id, 'decline')}
								className="h-8 gap-1 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
							>
								<X size={13} />
								<span>{t('friends.decline')}</span>
							</Button>
						</>
					}
				/>
			))}
		</div>
	);
};

/** Requests the current user sent that are still waiting, with cancel. */
export const SentRequests = ({ items, loadingId, onAction }: ListProps) => {
	const { t } = useTranslation();
	if (items.length === 0) return <EmptyState title={t('friends.none_sent')} />;

	return (
		<div className="flex flex-col gap-2">
			{items.map((req) => (
				<RelationshipCard
					key={req.to_user_id}
					userId={req.to_user_id}
					avatarId={req.user?.avatar_id}
					name={req.user?.username || t('friends.unknown_user')}
					subtitle={`${t('friends.pending_response')} • ~${req.user?.domain || 'localhost'}`}
					actions={
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={loadingId === req.to_user_id}
							onClick={() => onAction(req.to_user_id, 'cancel')}
							className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
						>
							{t('friends.cancel_request')}
						</Button>
					}
				/>
			))}
		</div>
	);
};

/** Blocked users, with unblock. */
export const BlockedUsers = ({ items, loadingId, onAction }: ListProps) => {
	const { t } = useTranslation();
	if (items.length === 0) return <EmptyState title={t('friends.none_blocked')} />;

	return (
		<div className="flex flex-col gap-2">
			{items.map((b) => (
				<RelationshipCard
					key={b.to_user_id}
					userId={b.to_user_id}
					avatarId={b.user?.avatar_id}
					name={b.user?.username || t('friends.blocked_user')}
					subtitle={t('friends.blocked_note')}
					actions={
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={loadingId === b.to_user_id}
							onClick={() => onAction(b.to_user_id, 'unblock')}
							className="h-8 rounded-lg px-3 text-xs font-semibold"
						>
							{t('friends.unblock')}
						</Button>
					}
				/>
			))}
		</div>
	);
};
