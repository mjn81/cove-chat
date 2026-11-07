import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/brand';
import { PopupClick, PopupDismiss, PopupDismissAll, PopupItems } from '@/wailsjs/go/main/PopupApp';
import { EventsOn } from '@/wailsjs/runtime/runtime';
import type { popup } from '@/wailsjs/go/models';
import { PauseTimer } from '../utils/pause-timer';

/** Height of one card in px; the desktop app sizes the window as a multiple of it (popup.CardHeight in Go). */
const CARD_HEIGHT = 76;
/** Height of the strip holding the dismiss-all button, shown from two popups up (popup.HeaderHeight in Go). */
const HEADER_HEIGHT = 28;
/** The gap between cards in px (popup.Gap in Go). */
const CARD_GAP = 4;
/** Fade-out time in ms before a timed-out popup is removed. */
const FADE_MS = 250;

interface PopupCardProps {
	item: popup.Item;
	onOpen: (id: string) => void;
	onClose: (id: string) => void;
}

/** One notification: icon, title and body, a close button, and a timer that pauses while the pointer is over it. */
function PopupCard({ item, onOpen, onClose }: PopupCardProps) {
	const { t } = useTranslation();
	const [leaving, setLeaving] = useState(false);
	const [timer] = useState(
		() =>
			new PauseTimer(item.ttl_ms, () => {
				setLeaving(true);
				setTimeout(() => onClose(item.id), FADE_MS);
			}),
	);

	useEffect(() => {
		timer.start();
		return () => timer.cancel();
	}, [timer]);

	return (
		<div
			role="button"
			tabIndex={0}
			style={{ height: CARD_HEIGHT, opacity: leaving ? 0 : 1, transition: `opacity ${FADE_MS}ms ease-out` }}
			className="flex w-full shrink-0 cursor-pointer items-center gap-3 bg-card px-3 text-start text-card-foreground hover:bg-accent"
			onMouseEnter={() => {
				if (leaving) return;
				timer.pause();
			}}
			onMouseLeave={() => {
				if (!leaving) timer.start();
			}}
			onClick={() => onOpen(item.id)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') onOpen(item.id);
			}}
		>
			<img src="/cove-icon.svg" alt={APP_NAME} className="size-10 shrink-0 rounded-md" draggable={false} />
			<div className="min-w-0 flex-1">
				<p dir="auto" className="truncate text-sm font-semibold">
					{item.title}
				</p>
				<p dir="auto" className="line-clamp-2 break-words text-sm text-muted-foreground">
					{item.body}
				</p>
			</div>
			<Button
				variant="ghost"
				size="icon"
				className="size-7 shrink-0 self-start text-muted-foreground"
				aria-label={t('notificationPopup.close')}
				onClick={(e) => {
					e.stopPropagation();
					onClose(item.id);
				}}
			>
				<X className="size-4" />
			</Button>
		</div>
	);
}

/**
 * The page rendered in the desktop app's notification window. It shows the stack of popups the Go side keeps,
 * takes its theme, language and direction from the newest one (this web view has none of the app's settings),
 * and reports dismissals and clicks back through the PopupApp bindings.
 */
export function NotificationPopup() {
	const { t, i18n } = useTranslation();
	const [items, setItems] = useState<popup.Item[]>([]);

	useEffect(() => {
		void PopupItems().then((list) => setItems(list ?? []));
		return EventsOn('popup:items', (list: popup.Item[] | null) => setItems(list ?? []));
	}, []);

	const newest = items[items.length - 1];
	useEffect(() => {
		if (!newest) return;
		const root = document.documentElement;
		root.classList.toggle('dark', newest.theme === 'dark');
		root.classList.toggle('light', newest.theme !== 'dark');
		root.lang = newest.lang;
		root.dir = newest.dir;
		void i18n.changeLanguage(newest.lang);
	}, [newest, i18n]);

	return (
		<div className="flex flex-col bg-background" style={{ gap: CARD_GAP }}>
			{items.length >= 2 && (
				<div className="flex shrink-0 items-center justify-end px-1" style={{ height: HEADER_HEIGHT }}>
					<Button
						variant="ghost"
						size="icon"
						className="size-6 text-muted-foreground"
						aria-label={t('notificationPopup.dismissAll')}
						title={t('notificationPopup.dismissAll')}
						onClick={() => void PopupDismissAll()}
					>
						<X className="size-4" />
					</Button>
				</div>
			)}
			{items.map((item) => (
				<PopupCard
					key={item.id}
					item={item}
					onOpen={(id) => void PopupClick(id)}
					onClose={(id) => void PopupDismiss(id)}
				/>
			))}
		</div>
	);
}
