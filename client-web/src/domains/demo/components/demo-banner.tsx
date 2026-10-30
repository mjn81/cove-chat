import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, X } from 'lucide-react';
import { useAuthStore } from '@/store/store';
import { useGetServerInfo } from '@/domains/auth/api/use-get-server-info';
import { dismissDemoBanner, isDemoBannerDismissed } from '../utils/demo-banner';

/**
 * Small dismissible notice shown on a public demo instance: data resets nightly and nothing private
 * should be entered. Only shown before sign-in (login / sign-up), so it never covers the chat UI. Renders nothing
 * on a normal server or while the server info is unknown.
 */
export function DemoBanner() {
	const { t } = useTranslation();
	const { data } = useGetServerInfo();
	const [dismissed, setDismissed] = useState(isDemoBannerDismissed);
	const signedIn = useAuthStore((state) => !!state.user);

	if (!data?.demo || dismissed || signedIn) return null;

	return (
		<div className="pointer-events-none fixed inset-x-0 top-[calc(var(--titlebar-h,0px)+0.5rem)] z-[60] flex justify-center px-2">
			<div
				role="status"
				className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
			>
				<FlaskConical className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
				<span className="truncate">{t('demo.banner')}</span>
				<button
					type="button"
					onClick={() => {
						dismissDemoBanner();
						setDismissed(true);
					}}
					className="shrink-0 rounded-full p-0.5 hover:bg-accent hover:text-foreground"
					aria-label={t('demo.dismiss')}
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	);
}
