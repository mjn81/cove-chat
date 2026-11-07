import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/brand';
import { PopupClick, PopupDismiss, PopupDismissAll, PopupItems } from '@/wailsjs/go/main/PopupApp';
import { EventsOn } from '@/wailsjs/runtime/runtime';
import type { popup } from '@/wailsjs/go/models';
import { PauseTimer } from '../utils/pause-timer';
import { EXIT_MS, cardMotion, nextLeaving, slotMotion, type MotionPhase } from '../utils/popup-motion';

/** Letter-avatar colours by tone (theme tokens only); the order matches `avatarTone`'s slots. */
const TONE_CLASSES = [
	'bg-primary text-primary-foreground',
	'bg-success text-success-foreground',
	'bg-warning text-warning-foreground',
	'bg-destructive text-destructive-foreground',
	'bg-secondary text-secondary-foreground',
];

/** The sender's photo, or their letter on a tone colour; the Cove icon only for Cove's own notices. */
function PopupAvatar({ item }: { item: popup.Item }) {
	if (item.avatar) {
		return <img src={item.avatar} alt="" className="size-10 shrink-0 rounded-full object-cover" draggable={false} />;
	}
	if (item.initial && !item.system) {
		return (
			<div
				aria-hidden
				className={`flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${TONE_CLASSES[item.tone] ?? TONE_CLASSES[0]}`}
			>
				{item.initial}
			</div>
		);
	}
	return <img src="/cove-icon.svg" alt={APP_NAME} className="size-10 shrink-0 rounded-md" draggable={false} />;
}

/** Height of one card in px; the desktop app sizes the window as a multiple of it (popup.CardHeight in Go). */
const CARD_HEIGHT = 76;
/** Height of the full-width "Close all" button, followed by one gap, shown from two popups up (popup.HeaderHeight in Go). */
const HEADER_HEIGHT = 32;
/** The gap between cards in px (popup.Gap in Go). */
const CARD_GAP = 4;
/** True when the user asked the system for reduced motion. */
function prefersReducedMotion(): boolean {
	return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface PopupCardProps {
	item: popup.Item;
	/** True for the top card when there is no "Close all" button above it (no gap is left above it then). */
	first: boolean;
	leaving: boolean;
	reducedMotion: boolean;
	onOpen: (id: string) => void;
	/** Starts the exit: the parent fades the card, then asks the desktop app to remove it. */
	onClose: (id: string) => void;
}

/** One notification: icon, title and body, a close button, and a timer that pauses while the pointer is over it. */
function PopupCard({ item, first, leaving, reducedMotion, onOpen, onClose }: PopupCardProps) {
	const { t } = useTranslation();
	const [entered, setEntered] = useState(false);
	const [timer] = useState(() => new PauseTimer(item.ttl_ms, () => onClose(item.id)));

	useEffect(() => {
		// Two frames: the first paints the card off-screen, the second lets the transition run.
		const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
		timer.start();
		return () => {
			cancelAnimationFrame(raf);
			timer.cancel();
		};
	}, [timer]);

	// A leaving card stops its countdown for good; hovering only ever pauses the timer, never the fade.
	useEffect(() => {
		if (leaving) timer.cancel();
	}, [leaving, timer]);

	const phase: MotionPhase = leaving ? 'leaving' : entered ? 'shown' : 'entering';

	return (
		<div style={slotMotion(phase, CARD_HEIGHT, CARD_GAP, first, reducedMotion)}>
		<div
			role="button"
			tabIndex={0}
			style={{ height: CARD_HEIGHT, ...cardMotion(phase, item.corner, reducedMotion) }}
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
			<PopupAvatar item={item} />
			<div className="min-w-0 flex-1">
				<p dir="auto" className="flex items-baseline gap-1.5 text-sm">
					<span className="truncate font-semibold">{item.title}</span>
					{item.subtitle && <span className="shrink-0 truncate text-xs text-muted-foreground">{item.subtitle}</span>}
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
	const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
	const [reducedMotion] = useState(prefersReducedMotion);
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

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

	useEffect(() => {
		const pending = timers.current;
		return () => pending.forEach(clearTimeout);
	}, []);

	// Fades the cards, then (only then) tells the desktop app to drop them, so the window and the stack stay
	// intact for the whole exit animation.
	const closeIds = (ids: string[], then: () => void) => {
		const fresh = ids.filter((id) => !leaving.has(id));
		if (fresh.length === 0) return;
		setLeaving((cur) =>
			nextLeaving(
				cur,
				fresh,
				items.map((i) => i.id),
			),
		);
		timers.current.push(setTimeout(then, EXIT_MS));
	};
	const closeOne = (id: string) => closeIds([id], () => void PopupDismiss(id));
	const closeAll = () =>
		closeIds(
			items.map((i) => i.id),
			() => void PopupDismissAll(),
		);

	const showHeader = items.length >= 2;
	return (
		<div className="flex flex-col justify-end overflow-hidden bg-background">
			{showHeader && (
				<Button
					variant="ghost"
					className="w-full shrink-0 rounded-none bg-card text-sm font-medium text-card-foreground hover:bg-accent"
					style={{ height: HEADER_HEIGHT }}
					onClick={closeAll}
				>
					{t('notificationPopup.dismissAll')}
				</Button>
			)}
			{items.map((item, index) => (
				<PopupCard
					key={item.id}
					item={item}
					first={index === 0 && !showHeader}
					leaving={leaving.has(item.id)}
					reducedMotion={reducedMotion}
					onOpen={(id) => void PopupClick(id)}
					onClose={closeOne}
				/>
			))}
		</div>
	);
}
