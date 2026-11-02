import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { APP_NAME } from '@/lib/brand';

/**
 * Placeholder for a message type this build cannot render (sent by a newer client or server). Keeps the message
 * in the timeline instead of failing the whole list.
 */
export function UnknownMessage() {
	const { t } = useTranslation();
	return (
		<div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
			<Sparkles className="h-4 w-4 shrink-0" aria-hidden />
			<span>{t('apiVersion.unknown_message', { app: APP_NAME })}</span>
		</div>
	);
}
