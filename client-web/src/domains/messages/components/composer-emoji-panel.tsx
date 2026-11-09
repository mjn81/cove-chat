import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { EmojiPickInfo } from '@/domains/emoji/components/emoji-picker-body';
import { placePanel, type Placement } from '@/domains/emoji/utils/panel-placement';
import type { PackItem } from '@/domains/stickers/types/stickers.types';
import { loadPanel } from '../utils/emoji-panel-loader';

// Picker, emoji dataset and sticker grid are one lazy chunk: nothing of it is in the first-load bundle.
const EmojiStickerPanel = lazy(loadPanel);

/** Preferred popover size; it shrinks to fit small windows. */
const PREFERRED = { width: 380, height: 440 };

interface ComposerEmojiPanelProps {
	/** Whether the panel is showing. The component stays mounted while hidden so reopening is instant and keeps its scroll. */
	open: boolean;
	/** The emoji button: the panel is placed relative to it. */
	anchor: React.RefObject<HTMLElement | null>;
	stickersEnabled: boolean;
	onEmoji: (text: string, info: EmojiPickInfo) => void;
	onSticker: (packId: string, item: PackItem) => void;
	onClose: () => void;
	/** Dock controls shown in the panel header (undefined hides them, e.g. when the window is too narrow to dock). */
	dock?: { docked: boolean; onToggle: () => void };
}

/**
 * Lazy-loaded emoji and sticker popover. It is rendered in a portal on the page body with fixed positioning computed
 * from the emoji button, so opening it can never push, shrink or re-layout the composer or the chat (an in-flow or
 * absolutely positioned child could, inside a webview with its own scroll and height rules). It closes on a click
 * outside (the emoji button, marked `data-emoji-toggle`, handles its own clicks) or Escape, never after picking.
 */
export function ComposerEmojiPanel({ open, anchor, stickersEnabled, onEmoji, onSticker, onClose, dock }: ComposerEmojiPanelProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [placement, setPlacement] = useState<Placement | null>(null);

	useEffect(() => {
		if (!open) return;
		const place = () => {
			const el = anchor.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
			setPlacement(placePanel(r, { width: window.innerWidth, height: window.innerHeight }, PREFERRED, rtl));
		};
		const frame = requestAnimationFrame(place);
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
		};
	}, [open, anchor]);

	useEffect(() => {
		if (!open) return;
		const pointer = (e: PointerEvent) => {
			const target = e.target as Element | null;
			if (ref.current?.contains(target as Node) || target?.closest?.('[data-emoji-toggle]')) return;
			// Select and tone menus render in their own portals; a click inside one is not "outside".
			if (target?.closest?.('[role="listbox"], [data-radix-popper-content-wrapper]')) return;
			onClose();
		};
		const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		document.addEventListener('pointerdown', pointer);
		document.addEventListener('keydown', key);
		return () => {
			document.removeEventListener('pointerdown', pointer);
			document.removeEventListener('keydown', key);
		};
	}, [open, onClose]);

	return createPortal(
		<div
			ref={ref}
			hidden={!open || !placement}
			className="fixed z-50"
			style={placement ? { left: placement.left, top: placement.top, width: placement.width, height: placement.height } : undefined}
		>
			<Suspense fallback={<div className="h-full rounded-2xl border border-border bg-popover" aria-hidden="true" />}>
				<EmojiStickerPanel stickersEnabled={stickersEnabled} onEmoji={onEmoji} onSticker={onSticker} dock={dock} fill />
			</Suspense>
		</div>,
		document.body,
	);
}
