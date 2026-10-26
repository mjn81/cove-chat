import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, ShieldAlert, UserPlus, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/store/store';
import { cn } from '@/lib/utils';
import { useFriendActions } from '../hooks/use-friend-actions';
import { AddFriendPanel } from './add-friend-panel';
import { BlockedUsers, FriendsList, PendingRequests, SentRequests } from './relationship-lists';

type SubTab = 'friends' | 'pending' | 'sent' | 'blocked';

interface FriendsTabProps {
	/** Called after a DM was opened so the surrounding settings modal can close. */
	onCloseModal?: () => void;
}

/** Counter pill on a sub-tab; `highlight` makes it the attention colour (unanswered requests). */
const Count = ({ value, highlight }: { value: number; highlight?: boolean }) =>
	value > 0 || !highlight ? (
		<Badge
			variant={highlight ? 'default' : 'secondary'}
			className={cn('px-1.5 py-0 font-mono text-[10px]', highlight && 'animate-pulse')}
		>
			{value}
		</Badge>
	) : null;

/**
 * Settings page for friends: add by username, then browse friends, requests
 * waiting for you, requests you sent, and blocked users.
 */
export const FriendsTab = ({ onCloseModal }: FriendsTabProps) => {
	const { t } = useTranslation();
	const relationships = useAuthStore((s) => s.relationships);
	const incomingRequests = useAuthStore((s) => s.incomingRequests);
	const { loadingId, act, startDM } = useFriendActions();
	const [tab, setTab] = useState<SubTab>('friends');

	const friends = relationships.filter((r) => r.type === 'friend');
	const sent = relationships.filter((r) => r.type === 'requested');
	const blocked = relationships.filter((r) => r.type === 'blocked');

	const handleMessage = async (userId: string) => {
		if (await startDM(userId)) onCloseModal?.();
	};

	const triggerClass = 'flex-1 gap-1.5 text-xs';

	return (
		<div className="mx-auto w-full max-w-[540px] pb-8 animate-in fade-in slide-in-from-right-4 duration-300">
			<AddFriendPanel onAccept={(userId) => act(userId, 'accept')} />

			<Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
				<TabsList className="mb-4 flex h-auto w-full">
					<TabsTrigger value="friends" className={triggerClass}>
						<Users size={14} />
						<span>{t('friends.tab_friends')}</span>
						<Count value={friends.length} />
					</TabsTrigger>
					<TabsTrigger value="pending" className={triggerClass}>
						<Clock size={14} />
						<span>{t('friends.tab_pending')}</span>
						<Count value={incomingRequests.length} highlight />
					</TabsTrigger>
					<TabsTrigger value="sent" className={triggerClass}>
						<UserPlus size={14} />
						<span>{t('friends.tab_sent')}</span>
						<Count value={sent.length} />
					</TabsTrigger>
					<TabsTrigger value="blocked" className={triggerClass}>
						<ShieldAlert size={14} />
						<span>{t('friends.tab_blocked')}</span>
						<Count value={blocked.length} />
					</TabsTrigger>
				</TabsList>

				<TabsContent value="friends">
					<FriendsList items={friends} loadingId={loadingId} onAction={act} onMessage={handleMessage} />
				</TabsContent>
				<TabsContent value="pending">
					<PendingRequests items={incomingRequests} loadingId={loadingId} onAction={act} />
				</TabsContent>
				<TabsContent value="sent">
					<SentRequests items={sent} loadingId={loadingId} onAction={act} />
				</TabsContent>
				<TabsContent value="blocked">
					<BlockedUsers items={blocked} loadingId={loadingId} onAction={act} />
				</TabsContent>
			</Tabs>
		</div>
	);
};

export default FriendsTab;
