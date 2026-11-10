import { useState } from 'react';
import { Bot as BotIcon, Loader2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ListRow } from '@/components/list-row';
import { SettingRow } from '@/components/setting-row';
import { useAuthStore } from '@/store/store';
import { useGetBots } from '../hooks/use-bots';
import type { Bot, CreateBotResponse } from '../types/bots.types';
import { BotBadge } from './bot-badge';
import { BotSecretDialog } from './bot-secret-dialog';
import { CreateBotDialog } from './create-bot-dialog';
import { ManageBotDialog } from './manage-bot-dialog';

function statusLine(bot: Bot, t: (k: string, o?: Record<string, unknown>) => string): string {
	const parts = [
		bot.disabled ? t('bots.status.disabled') : bot.online ? t('bots.status.online') : t('bots.status.offline'),
		bot.public ? t('bots.status.public') : t('bots.status.private'),
		t('bots.list.installs', { count: bot.install_count }),
	];
	return parts.join(' · ');
}

/** Settings > Bots: create and manage the bots you own (server admins can list every bot on the server). */
export function BotsTab() {
	const { t } = useTranslation();
	const isAdmin = Boolean(useAuthStore((s) => s.user?.server_role));
	const [all, setAll] = useState(false);
	const { data, isLoading } = useGetBots(all && isAdmin);
	const [creating, setCreating] = useState(false);
	const [managing, setManaging] = useState<Bot | null>(null);
	const [secrets, setSecrets] = useState<{ token?: string; webhookSecret?: string } | null>(null);

	const onCreated = (res: CreateBotResponse) => setSecrets({ token: res.token, webhookSecret: res.webhook_secret });

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-bold text-foreground">{t('bots.list.title')}</h2>
				<p className="mt-1 text-sm text-muted-foreground">{t('bots.list.subtitle')}</p>
			</div>

			{data && !data.enabled && (
				<p className="rounded-md border border-border bg-muted p-3 text-sm">{t('bots.list.disabled_server')}</p>
			)}

			<div className="space-y-2">
				<Button onClick={() => setCreating(true)} disabled={!data?.can_create} className="gap-2">
					<Plus size={16} />
					{t('bots.list.create')}
				</Button>
				{data && data.enabled && !data.can_create && (
					<p className="text-xs text-muted-foreground">
						{data.items.length >= data.max_per_user && !all
							? t('bots.list.limit_reached', { count: data.max_per_user })
							: t('bots.list.cannot_create')}
					</p>
				)}
			</div>

			{isAdmin && (
				<SettingRow title={t('bots.list.all_toggle')}>
					<Switch checked={all} onCheckedChange={setAll} aria-label={t('bots.list.all_toggle')} />
				</SettingRow>
			)}

			{isLoading && <Loader2 className="animate-spin text-primary" />}
			{data && data.items.length === 0 && (
				<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-muted-foreground">
					<BotIcon size={28} />
					<p className="text-sm">{t('bots.list.empty')}</p>
				</div>
			)}
			<div className="space-y-1">
				{data?.items.map((bot) => (
					<ListRow
						key={bot.id}
						leading={<Avatar userId={bot.id} avatarId={bot.avatar_id} size={36} />}
						title={
							<span className="flex items-center gap-2">
								<span className="truncate">{bot.username}</span>
								<BotBadge />
							</span>
						}
						subtitle={statusLine(bot, t)}
						trailing={
							<Button size="sm" variant="secondary" onClick={() => setManaging(bot)}>
								{t('bots.list.manage')}
							</Button>
						}
					/>
				))}
			</div>

			<CreateBotDialog open={creating} onOpenChange={setCreating} onCreated={onCreated} />
			<ManageBotDialog key={managing?.id ?? 'none'} bot={managing} onClose={() => setManaging(null)} onSecret={setSecrets} />
			<BotSecretDialog token={secrets?.token} webhookSecret={secrets?.webhookSecret} onClose={() => setSecrets(null)} />
		</div>
	);
}
