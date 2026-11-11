import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Avatar } from '@/components/Avatar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { IconButton } from '@/components/icon-button';
import { ListRow } from '@/components/list-row';
import { ModalShell } from '@/components/modal-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import type { Channel } from '@/types/api';
import { errorText } from '../hooks/use-bot-interaction';
import {
	useBotsSupported,
	useDiscoverBots,
	useGetBots,
	useGetChannelBots,
	useInstallBot,
	useUninstallBot,
} from '../hooks/use-bots';
import { ALL_BOT_SCOPES, type Bot, type BotScope } from '../types/bots.types';
import { BotBadge } from './bot-badge';

/** `messages.send` -> `messages_send`, the i18n key form (dots would nest). */
const scopeKey = (s: BotScope) => s.replace('.', '_');

function ScopePicker({ value, onChange }: { value: BotScope[]; onChange: (v: BotScope[]) => void }) {
	const { t } = useTranslation();
	return (
		<div className="space-y-2">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('bots.channel.permissions')}</p>
			{ALL_BOT_SCOPES.map((scope) => {
				const checked = value.includes(scope);
				return (
					<label key={scope} className="flex cursor-pointer items-start gap-3 rounded-md p-1.5 hover:bg-accent">
						<Checkbox
							checked={checked}
							onCheckedChange={(c) => onChange(c ? [...value, scope] : value.filter((s) => s !== scope))}
							className="mt-0.5"
						/>
						<span className="min-w-0">
							<span className="block text-sm font-medium">{t(`bots.scope.${scopeKey(scope)}.label`)}</span>
							<span className="block text-xs text-muted-foreground">{t(`bots.scope.${scopeKey(scope)}.hint`)}</span>
						</span>
					</label>
				);
			})}
		</div>
	);
}

function InstallDialog({ channelId, onClose }: { channelId: string; onClose: () => void }) {
	const { t } = useTranslation();
	const [q, setQ] = useState('');
	const debounced = useDebounce(q.trim(), 300);
	const mine = useGetBots(false);
	const found = useDiscoverBots(debounced);
	const install = useInstallBot(channelId);
	const [picked, setPicked] = useState<Bot | null>(null);
	const [scopes, setScopes] = useState<BotScope[]>(['messages.send']);

	// My own bots first, then public ones I do not own, without duplicates.
	const mineIds = new Set(mine.data?.items.map((b) => b.id));
	const list = [...(mine.data?.items ?? []).filter((b) => !b.disabled), ...(found.data?.items ?? []).filter((b) => !mineIds.has(b.id))].filter(
		(b) => !debounced || b.username.includes(debounced.toLowerCase()),
	);

	const submit = async () => {
		if (!picked) return;
		try {
			await install.mutateAsync({ botId: picked.id, scopes });
			toast.success(t('bots.channel.installed'));
			onClose();
		} catch (err) {
			toast.error(errorText(err, t('apiErrors.bot_install_failed')));
		}
	};

	return (
		<ModalShell
			open
			onOpenChange={(o) => !o && onClose()}
			title={t('bots.channel.install_title')}
			footer={
				<Button onClick={submit} disabled={!picked || scopes.length === 0 || install.isPending}>
					{install.isPending && <Loader2 size={14} className="me-2 animate-spin" />}
					{t('bots.channel.submit')}
				</Button>
			}
		>
			<div className="space-y-4">
				{!picked ? (
					<>
						<Input
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder={t('bots.channel.search')}
							aria-label={t('bots.channel.search')}
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
						/>
						<div className="max-h-64 space-y-0.5 overflow-y-auto">
							{list.map((b) => (
								<ListRow
									key={b.id}
									onClick={() => setPicked(b)}
									leading={<Avatar userId={b.id} avatarId={b.avatar_id} size={32} />}
									title={
										<span className="flex items-center gap-2">
											<span className="truncate">{b.username}</span>
											<BotBadge />
										</span>
									}
									subtitle={b.description}
								/>
							))}
							{list.length === 0 && <p className="p-3 text-sm italic text-muted-foreground">{t('bots.channel.none_found')}</p>}
						</div>
					</>
				) : (
					<>
						<ListRow
							leading={<Avatar userId={picked.id} avatarId={picked.avatar_id} size={32} />}
							title={
								<span className="flex items-center gap-2">
									<span className="truncate">{picked.username}</span>
									<BotBadge />
								</span>
							}
							subtitle={picked.description}
							trailing={
								<IconButton label={t('common.close')} size="sm" onClick={() => setPicked(null)}>
									<X size={14} />
								</IconButton>
							}
						/>
						<ScopePicker value={scopes} onChange={setScopes} />
						<p className="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">{t('bots.channel.consent')}</p>
					</>
				)}
			</div>
		</ModalShell>
	);
}

/**
 * The "Bots" section of the channel settings: installed bots with their permissions, remove buttons and the add
 * flow. Channel admins only (the server enforces it too); hidden on servers without the Bot API.
 */
export function ChannelBotsSection({ channel }: { channel: Channel }) {
	const { t } = useTranslation();
	const supported = useBotsSupported();
	const { data, isLoading } = useGetChannelBots(channel.id);
	const uninstall = useUninstallBot(channel.id);
	const [adding, setAdding] = useState(false);
	const [removing, setRemoving] = useState<Bot | null>(null);

	if (!supported) return null;

	const remove = async () => {
		if (!removing) return;
		try {
			await uninstall.mutateAsync(removing.id);
			toast.success(t('bots.channel.removed'));
		} catch (err) {
			toast.error(errorText(err, t('apiErrors.bot_install_failed')));
		}
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold">{t('bots.channel.title')}</h3>
				<Button type="button" size="sm" variant="secondary" className="gap-1" onClick={() => setAdding(true)}>
					<Plus size={14} />
					{t('bots.channel.add')}
				</Button>
			</div>
			{isLoading && <Loader2 className="animate-spin text-primary" size={16} />}
			{data && data.items.length === 0 && <p className="text-sm italic text-muted-foreground">{t('bots.channel.empty')}</p>}
			{data?.items.map((cb) => (
				<ListRow
					key={cb.bot.id}
					leading={<Avatar userId={cb.bot.id} avatarId={cb.bot.avatar_id} size={32} />}
					title={
						<span className="flex items-center gap-2">
							<span className="truncate">{cb.bot.username}</span>
							<BotBadge />
						</span>
					}
					subtitle={cb.scopes.map((s) => t(`bots.scope.${scopeKey(s)}.label`)).join(' · ')}
					trailing={
						<IconButton label={t('bots.channel.remove', { name: cb.bot.username })} size="sm" onClick={() => setRemoving(cb.bot)}>
							<X size={14} />
						</IconButton>
					}
				/>
			))}
			{adding && <InstallDialog channelId={channel.id} onClose={() => setAdding(false)} />}
			<ConfirmModal
				isOpen={removing !== null}
				onClose={() => setRemoving(null)}
				onConfirm={remove}
				title={t('bots.channel.remove', { name: removing?.username ?? '' })}
				message={t('bots.channel.remove_confirm', { name: removing?.username ?? '' })}
				variant="danger"
			/>
		</div>
	);
}
