import { useState } from 'react';
import { KeyRound, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ConfirmModal } from '@/components/ConfirmModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/form-field';
import { ModalShell } from '@/components/modal-shell';
import { SettingRow } from '@/components/setting-row';
import { errorText } from '../hooks/use-bot-interaction';
import { useDeleteBot, useRotateBotToken, useUpdateBot } from '../hooks/use-bots';
import type { Bot } from '../types/bots.types';

interface ManageBotDialogProps {
	bot: Bot | null;
	onClose: () => void;
	/** Shows the one-time secret dialog for a rotated token or webhook secret. */
	onSecret: (secrets: { token?: string; webhookSecret?: string }) => void;
}

/** Edit a bot: description, visibility, enabled switch, webhook, token rotation and deletion. */
export function ManageBotDialog({ bot, onClose, onSecret }: ManageBotDialogProps) {
	const { t } = useTranslation();
	const update = useUpdateBot();
	const rotate = useRotateBotToken();
	const remove = useDeleteBot();
	const [description, setDescription] = useState(bot?.description ?? '');
	const [webhook, setWebhook] = useState(bot?.webhook_url ?? '');
	const [isPublic, setPublic] = useState(bot?.public ?? false);
	const [enabled, setEnabled] = useState(!(bot?.disabled ?? false));
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [confirmRotate, setConfirmRotate] = useState(false);

	if (!bot) return null;

	const save = async () => {
		try {
			const res = await update.mutateAsync({
				id: bot.id,
				input: {
					description,
					public: isPublic,
					disabled: !enabled,
					...(webhook.trim() !== (bot.webhook_url ?? '') ? { webhook_url: webhook.trim() } : {}),
				},
			});
			toast.success(t('bots.manage.saved'));
			if (res.webhook_secret) onSecret({ webhookSecret: res.webhook_secret });
			onClose();
		} catch (err) {
			toast.error(errorText(err, t('apiErrors.bot_update_failed')));
		}
	};

	const rotateToken = async () => {
		try {
			const res = await rotate.mutateAsync(bot.id);
			onSecret({ token: res.token });
		} catch (err) {
			toast.error(errorText(err, t('apiErrors.bot_update_failed')));
		}
	};

	const rotateWebhook = async () => {
		try {
			const res = await update.mutateAsync({ id: bot.id, input: { rotate_webhook_secret: true } });
			if (res.webhook_secret) onSecret({ webhookSecret: res.webhook_secret });
		} catch (err) {
			toast.error(errorText(err, t('apiErrors.bot_update_failed')));
		}
	};

	const doDelete = async () => {
		try {
			await remove.mutateAsync(bot.id);
			toast.success(t('bots.manage.deleted'));
			onClose();
		} catch (err) {
			toast.error(errorText(err, t('apiErrors.bot_delete_failed')));
		}
	};

	return (
		<>
			<ModalShell
				open
				onOpenChange={(o) => !o && onClose()}
				title={t('bots.manage.title', { name: bot.username })}
				footer={
					<Button onClick={save} disabled={update.isPending}>
						{update.isPending && <Loader2 size={14} className="me-2 animate-spin" />}
						{t('bots.manage.save')}
					</Button>
				}
			>
				<div className="space-y-4">
					<FormField label={t('bots.manage.description')}>
						{(c) => (
							<Textarea {...c} rows={2} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} />
						)}
					</FormField>
					<SettingRow title={t('bots.manage.enabled')}>
						<Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t('bots.manage.enabled')} />
					</SettingRow>
					<SettingRow title={t('bots.manage.public')}>
						<Switch checked={isPublic} onCheckedChange={setPublic} aria-label={t('bots.manage.public')} />
					</SettingRow>
					<FormField
						label={t('bots.manage.webhook')}
						hint={webhook.trim() === '' ? t('bots.manage.webhook_empty') : undefined}
					>
						{(c) => (
							<Input
								{...c}
								dir="ltr"
								type="url"
								placeholder="https://"
								value={webhook}
								onChange={(e) => setWebhook(e.target.value)}
								autoComplete="off"
								autoCapitalize="off"
								autoCorrect="off"
								spellCheck={false}
							/>
						)}
					</FormField>
					{bot.webhook_url && (
						<Button type="button" variant="secondary" size="sm" className="gap-2" onClick={rotateWebhook}>
							<KeyRound size={14} />
							{t('bots.manage.rotate_webhook')}
						</Button>
					)}

					<div className="space-y-2 border-t border-border pt-4">
						<Button type="button" variant="secondary" className="gap-2" onClick={() => setConfirmRotate(true)}>
							<KeyRound size={14} />
							{t('bots.manage.rotate_token')}
						</Button>
						<p className="text-xs text-muted-foreground">{t('bots.manage.rotate_token_hint')}</p>
						<Button type="button" variant="destructive" className="gap-2" onClick={() => setConfirmDelete(true)}>
							<Trash2 size={14} />
							{t('bots.manage.delete')}
						</Button>
					</div>
				</div>
			</ModalShell>
			<ConfirmModal
				isOpen={confirmRotate}
				onClose={() => setConfirmRotate(false)}
				onConfirm={rotateToken}
				title={t('bots.manage.rotate_token')}
				message={t('bots.manage.rotate_token_hint')}
				confirmText={t('bots.manage.rotate_token')}
				variant="danger"
			/>
			<ConfirmModal
				isOpen={confirmDelete}
				onClose={() => setConfirmDelete(false)}
				onConfirm={doDelete}
				title={t('bots.manage.delete')}
				message={t('bots.manage.delete_confirm', { name: bot.username })}
				confirmText={t('bots.manage.delete')}
				variant="danger"
			/>
		</>
	);
}
