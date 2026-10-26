import { useTranslation } from 'react-i18next';
import { Check, Clock, Loader2, Search, UserPlus, X } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/icon-button';
import { Input } from '@/components/ui/input';
import { StatusDot } from '@/domains/users/components/status-dot';
import { useAuthStore } from '@/store/store';
import { cn } from '@/lib/utils';
import { useAddFriend } from '../hooks/use-add-friend';
import { getRelationState } from '../utils/relation-state';

interface AddFriendPanelProps {
	/** Accepts an incoming request found through search. */
	onAccept: (userId: string) => void;
}

/**
 * "Add friend" section: username field with live result cards (each shows
 * the current relationship state) and a send-request button.
 */
export const AddFriendPanel = ({ onAccept }: AddFriendPanelProps) => {
	const { t } = useTranslation();
	const relationships = useAuthStore((s) => s.relationships);
	const incomingRequests = useAuthStore((s) => s.incomingRequests);
	const add = useAddFriend();

	return (
		<div className="mb-6">
			<h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
				<UserPlus className="h-4 w-4 text-primary" />
				{t('friends.add_title')}
			</h3>
			<p className="mb-3 text-xs text-muted-foreground">{t('friends.add_desc')}</p>

			<div className="relative">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						add.submit();
					}}
					className="flex gap-2"
				>
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={add.username}
							onChange={(e) => add.changeUsername(e.target.value)}
							placeholder={t('friends.add_placeholder')}
							aria-label={t('friends.add_placeholder')}
							className="h-9 ps-9 pe-8 text-sm"
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
						/>
						{add.isSearching ? (
							<Loader2 className="absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
						) : add.username ? (
							<IconButton
								label={t('friends.clear')}
								onClick={add.clear}
								className="absolute end-1.5 top-1/2 h-6 w-6 -translate-y-1/2"
							>
								<X size={14} />
							</IconButton>
						) : null}
					</div>
					<Button
						type="submit"
						disabled={add.isAdding || !add.username.trim()}
						className="h-9 shrink-0 px-4 text-xs"
					>
						{add.isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : t('friends.send_request')}
					</Button>
				</form>

				{add.debouncedUsername && (
					<div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-popover">
						{add.isSearching && add.results.length === 0 ? (
							<div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin text-primary" />
								<span>{t('friends.searching_directory')}</span>
							</div>
						) : add.results.length > 0 ? (
							<div className="flex max-h-56 flex-col overflow-y-auto p-1">
								<div className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
									{t('friends.found_users')}
								</div>
								{add.results.map((target) => {
									const state = getRelationState(target.id, relationships, incomingRequests);
									return (
										<div
											key={target.id}
											className="flex items-center justify-between rounded-md p-2 transition-colors hover:bg-accent"
										>
											<div className="flex min-w-0 items-center gap-2.5">
												<div className="relative shrink-0">
													<Avatar userId={target.id} avatarId={target.avatar_id} size={36} />
													<StatusDot
														status={target.status}
														className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 border-2 border-popover"
													/>
												</div>
												<div className="min-w-0">
													<div className="truncate text-xs font-bold text-foreground">
														{target.username}
													</div>
													<div className="truncate text-[11px] text-muted-foreground">
														~{target.domain || 'localhost'}
														{target.custom_msg && ` • "${target.custom_msg}"`}
													</div>
												</div>
											</div>

											<div className="ms-2 shrink-0">
												{state === 'friend' ? (
													<Badge variant="outline" className="gap-1 border-success/20 bg-success/10 text-success">
														<Check size={12} />
														{t('friends.state_friends')}
													</Badge>
												) : state === 'requested' ? (
													<Badge variant="outline" className="gap-1 border-warning/20 bg-warning/10 text-warning">
														<Clock size={12} />
														{t('friends.state_pending')}
													</Badge>
												) : state === 'incoming' ? (
													<Button
														type="button"
														size="sm"
														disabled={add.isAdding}
														onClick={() => onAccept(target.id)}
														className="h-7 gap-1 bg-success px-2 text-xs text-success-foreground hover:bg-success/90"
													>
														<Check size={12} />
														{t('friends.accept')}
													</Button>
												) : state === 'blocked' ? (
													<Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
														{t('friends.state_blocked')}
													</Badge>
												) : (
													<Button
														type="button"
														size="sm"
														disabled={add.isAdding}
														onClick={() => add.sendTo(target.id, target.username)}
														className="h-7 gap-1 px-2.5 text-xs"
													>
														{add.isAdding ? (
															<Loader2 size={12} className="animate-spin" />
														) : (
															<UserPlus size={12} />
														)}
														{t('friends.add_friend')}
													</Button>
												)}
											</div>
										</div>
									);
								})}
							</div>
						) : (
							<div className="px-3 py-3 text-center text-xs text-muted-foreground">
								{t('friends.no_user_found', { name: add.debouncedUsername })}
							</div>
						)}
					</div>
				)}
			</div>

			{add.status && (
				<p
					role="status"
					className={cn(
						'mt-2.5 flex items-center gap-1.5 text-xs font-medium',
						add.status.type === 'success' ? 'text-success' : 'text-destructive',
					)}
				>
					{add.status.type === 'success' ? <Check size={14} /> : <X size={14} />}
					{add.status.message}
				</p>
			)}
		</div>
	);
};
