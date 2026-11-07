import type { CSSProperties } from 'react';

/** How long a popup takes to slide/fade in, in ms. */
export const ENTER_MS = 220;
/**
 * How long a popup takes to fade out and collapse before it is removed, in ms. The desktop app keeps the card
 * (and the window) until the UI reports the dismissal after this time.
 */
export const EXIT_MS = 180;

/** Where a popup is in its life. */
export type MotionPhase = 'entering' | 'shown' | 'leaving';

/** Whether the corner the popups stack from is on the left of the screen. */
export function isLeftCorner(corner: string | undefined): boolean {
	return !!corner && corner.endsWith('left');
}

/**
 * The style of a popup card for a phase. Normally it slides in horizontally from the screen edge of its corner
 * (the window clips it) while fading; with reduced motion it only fades. Leaving is always a plain fade.
 */
export function cardMotion(phase: MotionPhase, corner: string | undefined, reducedMotion: boolean): CSSProperties {
	const hidden = phase !== 'shown';
	const slide = phase === 'entering' && !reducedMotion ? (isLeftCorner(corner) ? '-100%' : '100%') : '0';
	const ms = phase === 'leaving' ? EXIT_MS : ENTER_MS;
	return {
		opacity: hidden ? 0 : 1,
		transform: `translateX(${slide})`,
		transition: reducedMotion
			? `opacity ${ms}ms ease-out`
			: `opacity ${ms}ms ease-out, transform ${ENTER_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
	};
}

/** The style of the wrapper that collapses a leaving card's slot so the cards around it close the gap smoothly. */
export function slotMotion(phase: MotionPhase, height: number, gap: number, first: boolean, reducedMotion: boolean): CSSProperties {
	const gone = phase === 'leaving';
	return {
		height: gone ? 0 : height,
		marginTop: gone || first ? 0 : gap,
		overflow: 'hidden',
		transition: reducedMotion ? undefined : `height ${EXIT_MS}ms ease-out, margin-top ${EXIT_MS}ms ease-out`,
	};
}

/**
 * Marks popups as leaving. Ids already leaving stay so; ids that are no longer on screen are forgotten so the set
 * cannot grow without bound.
 */
export function nextLeaving(current: ReadonlySet<string>, start: readonly string[], present: readonly string[]): Set<string> {
	const keep = new Set(present);
	const out = new Set<string>();
	for (const id of [...current, ...start]) if (keep.has(id)) out.add(id);
	return out;
}
