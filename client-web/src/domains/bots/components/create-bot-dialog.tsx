import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/form-field';
import { ModalShell } from '@/components/modal-shell';
import { SettingRow } from '@/components/setting-row';
import { errorText } from '../hooks/use-bot-interaction';
import { useCreateBot } from '../hooks/use-bots';
import type { CreateBotResponse } from '../types/bots.types';
import { isValidBotName } from '../utils/bot-name';

interface CreateBotDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called with the created bot and its one-time token. */
	onCreated: (res: CreateBotResponse) => void;
}

/** Form for creating a bot: name, description, visibility and an optional webhook. */
export function CreateBotDialog({ open, onOpenChange, onCreated }: CreateBotDialogProps) {
	const { t } = useTranslation();
	const create = useCreateBot();
	const [username, setUsername] = useState('');
	const [description, setDescription] = useState('');
	const [isPublic, setPublic] = useState(false);
	const [webhook, setWebhook] = useState('');

	const nameOk = isValidBotName(username.trim());
	const submit = async () => {
		try {
			const res = await create.mutateAsync({
				username: username.trim(),
				description: description.trim() || undefined,
				public: isPublic || undefined,
				webhook_url: webhook.trim() || undefined,
			});
			setUsername('');
			setDescription('');
			setPublic(false);
			setWebhook('');
			onOpenChange(false);
			onCreated(res);
		} catch (err) {
			toast.error(errorText(err, t('apiErrors.bot_create_failed')));
		}
	};

	return (
		<ModalShell
			open={open}
			onOpenChange={onOpenChange}
			title={t('bots.create.title')}
			footer={
				<Button onClick={submit} disabled={!nameOk || create.isPending}>
					{create.isPending && <Loader2 size={14} className="me-2 animate-spin" />}
					{t('bots.create.submit')}
				</Button>
			}
		>
			<div className="space-y-4">
				<FormField
					label={t('bots.create.username')}
					required
					hint={t('bots.create.username_hint')}
					error={username && !nameOk ? t('apiErrors.bot_name_invalid') : undefined}
				>
					{(c) => (
						<Input
							{...c}
							dir="ltr"
							value={username}
							maxLength={32}
							onChange={(e) => setUsername(e.target.value)}
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
						/>
					)}
				</FormField>
				<FormField label={t('bots.create.description')}>
					{(c) => (
						<Textarea
							{...c}
							rows={2}
							maxLength={400}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							autoComplete="off"
						/>
					)}
				</FormField>
				<SettingRow title={t('bots.create.public')} description={t('bots.create.public_hint')}>
					<Switch checked={isPublic} onCheckedChange={setPublic} aria-label={t('bots.create.public')} />
				</SettingRow>
				<FormField label={t('bots.create.webhook')} hint={t('bots.create.webhook_hint')}>
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
			</div>
		</ModalShell>
	);
}
