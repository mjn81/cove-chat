import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Minus, Square, X } from 'lucide-react';
import { isMac } from '@/utils/wails';
import { WindowIsMaximised, WindowMinimise, WindowToggleMaximise } from '@/wailsjs/runtime/runtime';
import { CloseWindow } from '@/wailsjs/go/main/App';
import { useDesktopChromeStore } from '@/domains/desktop/store/chrome.store';
import { titleBarLayout } from '@/domains/desktop/utils/titlebar-layout';

// Wails reads this custom property to decide which regions drag the frameless window.
const DRAG: React.CSSProperties = { ['--wails-draggable' as string]: 'drag' };
const NO_DRAG: React.CSSProperties = { ['--wails-draggable' as string]: 'no-drag' };

interface CaptionButtonProps {
	label: string;
	onClick: () => void;
	danger?: boolean;
	children: React.ReactNode;
}

const CaptionButton: React.FC<CaptionButtonProps> = ({ label, onClick, danger, children }) => (
	<button
		type="button"
		onClick={onClick}
		title={label}
		aria-label={label}
		style={NO_DRAG}
		className={`flex h-full w-11 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground ${
			danger ? 'hover:bg-destructive hover:text-destructive-foreground' : 'hover:bg-accent'
		}`}
	>
		{children}
	</button>
);

/**
 * Title strip for the desktop (Wails) shell, with no title text so the window reads as one piece, Telegram-style.
 *
 * - Windows and Linux run frameless, so the bar supplies the drag area and the minimise / maximise / close buttons.
 * - macOS keeps its native traffic lights. Inside the chat shell they sit in the left column (see `MacLightsSpacer`)
 *   and this bar draws nothing; on other screens it is a borderless strip in the page colour that only holds the
 *   lights and a drag area.
 *
 * Renders nothing in a browser (the caller only mounts it in the desktop app).
 */
export const DesktopTitleBar: React.FC = () => {
	const { t } = useTranslation();
	const mac = isMac();
	const inAppShell = useDesktopChromeStore((s) => s.inAppShell);
	const layout = titleBarLayout({ mac, inAppShell });
	const [maximised, setMaximised] = useState(false);

	// Expose the height before paint so the first layout already accounts for the bar (0 when it steps aside).
	useLayoutEffect(() => {
		const root = document.documentElement;
		root.style.setProperty('--titlebar-h', `${layout.height}px`);
		return () => {
			root.style.removeProperty('--titlebar-h');
		};
	}, [layout.height]);

	const syncMaximised = useCallback(() => {
		WindowIsMaximised()
			.then(setMaximised)
			.catch(() => {
				/* runtime not ready yet: keep the previous icon */
			});
	}, []);

	useEffect(() => {
		syncMaximised();
		window.addEventListener('resize', syncMaximised);
		return () => window.removeEventListener('resize', syncMaximised);
	}, [syncMaximised]);

	if (!layout.visible) return null;

	return (
		<div
			dir="ltr"
			style={{ ...DRAG, height: layout.height }}
			// z-[110] keeps the bar (and so the drag area and the macOS traffic-light zone) above dialogs, sheets and the
			// media viewer, whose layers start below it via `top-[var(--titlebar-h,0px)]`.
			className={`relative z-[110] flex w-full shrink-0 select-none items-center ${
				layout.blended ? 'bg-background' : 'border-b border-border bg-card'
			}`}
		>
			{/* Empty on purpose: like Telegram, the bar is just a drag handle and the caption buttons. */}
			<div className="min-w-0 flex-1" style={{ paddingInlineStart: layout.lightsInset }} />

			{layout.captionButtons && (
				<div className="flex h-full shrink-0">
					<CaptionButton label={t('window.minimize')} onClick={WindowMinimise}>
						<Minus size={14} strokeWidth={1.5} />
					</CaptionButton>
					<CaptionButton
						label={maximised ? t('window.restore') : t('window.maximize')}
						onClick={WindowToggleMaximise}
					>
						{maximised ? <Copy size={11} strokeWidth={1.5} className="-scale-x-100" /> : <Square size={11} strokeWidth={1.5} />}
					</CaptionButton>
					<CaptionButton label={t('window.close')} onClick={() => void CloseWindow()} danger>
						<X size={15} strokeWidth={1.5} />
					</CaptionButton>
				</div>
			)}
		</div>
	);
};
