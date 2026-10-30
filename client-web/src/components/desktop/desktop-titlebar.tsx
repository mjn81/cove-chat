import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Minus, Square, X } from 'lucide-react';
import { isMac } from '@/utils/wails';
import { WindowIsMaximised, WindowMinimise, WindowToggleMaximise } from '@/wailsjs/runtime/runtime';
import { CloseWindow } from '@/wailsjs/go/main/App';

/** Height of the bar in px; mirrored to `--titlebar-h` so full-height layouts (`.h-screen`) can subtract it. */
const TITLEBAR_HEIGHT = 28;
/** Room left for the macOS traffic lights, which the OS draws over the top-left of the web view. */
const MAC_TRAFFIC_LIGHTS_INSET = 78;

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
 * Slim title strip for the desktop (Wails) shell, drawn in the app's own surface colour with no title so
 * the window reads as one piece, Telegram-style. Windows and Linux run frameless, so this bar supplies the drag area and the minimise /
 * maximise / close buttons; on macOS the native traffic lights stay and the bar only reserves space for them.
 * Renders nothing in a browser.
 */
export const DesktopTitleBar: React.FC = () => {
	const { t } = useTranslation();
	const mac = isMac();
	const [maximised, setMaximised] = useState(false);

	// Expose the height before paint so the first layout already accounts for the bar.
	useLayoutEffect(() => {
		const root = document.documentElement;
		root.style.setProperty('--titlebar-h', `${TITLEBAR_HEIGHT}px`);
		return () => {
			root.style.removeProperty('--titlebar-h');
		};
	}, []);

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

	return (
		<div
			dir="ltr"
			style={{ ...DRAG, height: TITLEBAR_HEIGHT }}
			// z-[110] keeps the bar (and so the drag area and the macOS traffic-light zone) above dialogs, sheets and the
			// media viewer, whose layers start below it via `top-[var(--titlebar-h,0px)]`.
			className="relative z-[110] flex w-full shrink-0 select-none items-center border-b border-border bg-card"
		>
			{/* Empty on purpose: like Telegram, the bar is just a drag handle and the caption buttons. */}
			<div className="min-w-0 flex-1" style={{ paddingInlineStart: mac ? MAC_TRAFFIC_LIGHTS_INSET : 0 }} />

			{!mac && (
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
