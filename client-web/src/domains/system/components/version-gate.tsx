import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/brand';
import { isWails } from '@/utils/wails';
import {
	CLIENT_OUTDATED_EVENT,
	isBelowMinimum,
	type ClientOutdatedDetail,
} from '@/lib/api-standard';
import { useServerCapabilities } from '../api/use-server-capabilities';

/**
 * Handles a client/server version mismatch (docs/api-standard.md section 7).
 *
 * - Hard: the server answered 426 `client_outdated` (see the API client). A full-screen notice explains why and
 *   offers Reload on the web or an update hint on desktop. Nothing else is rendered over it.
 * - Soft: the server advertises a `min_client_version` newer than this build. A dismissible banner warns that
 *   some features are unavailable; the app stays fully usable.
 */
export function VersionGate() {
	const { t } = useTranslation();
	const { minClientVersion } = useServerCapabilities();
	const [hard, setHard] = useState<ClientOutdatedDetail | null>(null);
	const [dismissed, setDismissed] = useState(false);

	useEffect(() => {
		const onOutdated = (e: Event) => setHard((e as CustomEvent<ClientOutdatedDetail>).detail ?? {});
		window.addEventListener(CLIENT_OUTDATED_EVENT, onOutdated);
		return () => window.removeEventListener(CLIENT_OUTDATED_EVENT, onOutdated);
	}, []);

	if (hard) {
		const min = hard.minClientVersion ?? minClientVersion;
		return (
			<div
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="version-gate-title"
				className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-6"
			>
				<div className="flex max-w-md flex-col items-center gap-4 text-center">
					<TriangleAlert className="h-10 w-10 text-primary" aria-hidden />
					<h1 id="version-gate-title" className="text-xl font-semibold text-foreground">
						{t('apiVersion.outdated_title', { app: APP_NAME })}
					</h1>
					<p className="text-sm text-muted-foreground">{t('apiVersion.outdated_body', { app: APP_NAME })}</p>
					{min && (
						<p className="text-xs text-muted-foreground">{t('apiVersion.outdated_min', { version: min })}</p>
					)}
					{isWails() ? (
						<p className="text-sm text-foreground">{t('apiVersion.desktop_hint', { app: APP_NAME })}</p>
					) : (
						<Button type="button" onClick={() => window.location.reload()}>
							<RefreshCw size={14} />
							<span>{t('apiVersion.reload')}</span>
						</Button>
					)}
				</div>
			</div>
		);
	}

	if (dismissed || !isBelowMinimum(__APP_VERSION__, minClientVersion)) return null;

	return (
		<div className="pointer-events-none fixed inset-x-0 top-[calc(var(--titlebar-h,0px)+0.5rem)] z-[60] flex justify-center px-2">
			<div
				role="status"
				className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
			>
				<TriangleAlert className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
				<span className="truncate">{t('apiVersion.soft_banner', { app: APP_NAME })}</span>
				<button
					type="button"
					onClick={() => setDismissed(true)}
					className="shrink-0 rounded-full p-0.5 hover:bg-accent hover:text-foreground"
					aria-label={t('apiVersion.dismiss')}
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	);
}
