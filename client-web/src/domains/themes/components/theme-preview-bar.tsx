import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { previewSession } from '../api/theme-actions';
import type { ActivePreview } from '../utils/preview-session';
import { PREVIEW_BAR_VARS } from '../utils/preview-bar-palette';
import { localizedThemeName } from '../utils/theme-name';

/** Seconds left until a preview reverts by itself, ticking once a second. Mounted only while a preview runs. */
function useSecondsLeft(expiresAt: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [expiresAt]);
	return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/**
 * The floating "Previewing X: Apply / Revert" bar. It is drawn with a fixed palette (the colours are set on the bar
 * itself), so whatever the previewed theme does to the app's tokens, the buttons that undo it stay readable. A
 * preview also ends on a route change, which is why this must sit inside the router.
 *
 * `pointer-events: auto` keeps the bar clickable while a modal dialog (Settings) has disabled the rest of the page.
 */
export function ThemePreviewBar() {
	const session = previewSession();
	const active = useSyncExternalStore(session.subscribe, session.current);
	const { pathname } = useLocation();

	useEffect(() => {
		// Leaving the page the preview was started on (login, 404, another route) never keeps a preview alive.
		return () => session.revert();
	}, [pathname, session]);

	return active ? <PreviewBarBody active={active} /> : null;
}

function PreviewBarBody({ active }: { active: ActivePreview }) {
	const { t, i18n } = useTranslation();
	const session = previewSession();
	const secondsLeft = useSecondsLeft(active.expiresAt);
	const [busy, setBusy] = useState(false);

	async function apply() {
		setBusy(true);
		const ok = await session.apply();
		setBusy(false);
		if (!ok) toast.error(t('themes.preview.apply_failed'));
	}

	return (
		<div
			role="region"
			aria-label={t('themes.preview.region')}
			style={{ ...(PREVIEW_BAR_VARS as CSSProperties), pointerEvents: 'auto' }}
			className="fixed inset-x-0 bottom-4 z-[200] mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-card-foreground"
		>
			<Eye size={16} className="shrink-0 text-primary" aria-hidden="true" />
			<div className="min-w-0 text-sm">
				<span className="font-semibold">
					{t('themes.preview.bar', { name: localizedThemeName(active.theme.name, i18n.language) })}
				</span>
				<span className="ms-2 text-xs text-muted-foreground" aria-live="off">
					{t('themes.preview.countdown', { seconds: secondsLeft })}
				</span>
			</div>
			<div className="flex gap-2">
				<Button type="button" size="sm" variant="secondary" onClick={() => session.revert()}>
					{t('themes.preview.revert')}
				</Button>
				<Button type="button" size="sm" disabled={busy} onClick={() => void apply()}>
					{t('themes.preview.apply')}
				</Button>
			</div>
		</div>
	);
}
