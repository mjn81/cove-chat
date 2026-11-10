import { useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/modal-shell';

interface SecretRowProps {
	label: string;
	value: string;
}

function SecretRow({ label, value }: SecretRowProps) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard access can be denied; the value is selectable text, so the user can still copy it by hand.
		}
	};
	return (
		<div className="space-y-1.5">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
			<div className="flex items-center gap-2 rounded-md border border-border bg-muted p-2">
				<code className="min-w-0 flex-1 select-all break-all font-mono text-xs" dir="ltr">
					{value}
				</code>
				<Button type="button" size="sm" variant="secondary" className="shrink-0 gap-1" onClick={copy}>
					{copied ? <Check size={14} /> : <Copy size={14} />}
					{copied ? t('bots.secret.copied') : t('bots.secret.copy')}
				</Button>
			</div>
		</div>
	);
}

interface BotSecretDialogProps {
	/** The bot token, shown once. Leave undefined when only a webhook secret is shown. */
	token?: string;
	webhookSecret?: string;
	onClose: () => void;
}

/** One-time reveal of a new bot token and/or webhook signing secret. They cannot be shown again. */
export function BotSecretDialog({ token, webhookSecret, onClose }: BotSecretDialogProps) {
	const { t } = useTranslation();
	const open = Boolean(token || webhookSecret);
	return (
		<ModalShell
			open={open}
			// The dialog only closes through the explicit button, so the secret is not lost by a stray click.
			onOpenChange={() => undefined}
			title={t('bots.secret.title')}
			footer={<Button onClick={onClose}>{t('bots.secret.done')}</Button>}
		>
			<div className="space-y-4">
				<div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
					<TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
					<p>{t('bots.secret.warning')}</p>
				</div>
				{token && <SecretRow label={t('bots.secret.token')} value={token} />}
				{webhookSecret && <SecretRow label={t('bots.secret.webhook')} value={webhookSecret} />}
			</div>
		</ModalShell>
	);
}
