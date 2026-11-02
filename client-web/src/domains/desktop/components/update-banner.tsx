import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useDesktopUpdateSync, useInstallUpdate } from '../hooks/use-desktop-update';
import { useDesktopUpdateStore } from '../store/update.store';
import { bannerKind } from '../utils/update-state';
import { RestartConfirmDialog } from './restart-confirm-dialog';

/**
 * "Update ready - Restart" prompt for the desktop app. It floats at the bottom end of the window, clear of the
 * title bar and the macOS traffic lights, and appears only once a verified update is staged. "Later" hides it for
 * that version. Mounted once in the app shell; renders nothing in a browser.
 */
export function UpdateBanner() {
	const { t } = useTranslation();
	useDesktopUpdateSync();
	const state = useDesktopUpdateStore((s) => s.state);
	const dismissedVersion = useDesktopUpdateStore((s) => s.dismissedVersion);
	const dismiss = useDesktopUpdateStore((s) => s.dismiss);
	const install = useInstallUpdate();
	const kind = bannerKind(state, dismissedVersion);
	if (!state || !kind) return null;

	return (
		<>
			<div
				role="status"
				aria-live="polite"
				className="fixed bottom-4 end-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm text-foreground"
			>
				<Download className="size-4 shrink-0 text-primary" />
				<span className="min-w-0 flex-1">
					{kind === 'restart'
						? t('desktopUpdate.banner.ready', { version: state.latest_version })
						: t('desktopUpdate.banner.available', { version: state.latest_version })}
				</span>
				{kind === 'restart' ? (
					<Button size="sm" onClick={install.request} disabled={install.installing}>
						{t('desktopUpdate.banner.restart')}
					</Button>
				) : (
					<Button size="sm" asChild>
						<a href={state.release_url} target="_blank" rel="noreferrer">
							{t('desktopUpdate.banner.download')}
						</a>
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon"
					className="size-7 shrink-0"
					aria-label={t('desktopUpdate.banner.later')}
					title={t('desktopUpdate.banner.later')}
					onClick={() => dismiss(state.latest_version)}
				>
					<X className="size-4" />
				</Button>
			</div>
			<RestartConfirmDialog controls={install} version={state.latest_version} />
		</>
	);
}
