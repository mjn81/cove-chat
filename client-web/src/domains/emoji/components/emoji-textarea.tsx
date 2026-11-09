import { forwardRef, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';
import { useFallbackStyleId, useLoadedEmojiStyle } from '../hooks/use-emoji';
import { mirrorEmojiStyle, mirrorSegments } from '../utils/composer-mirror';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & { value: string };

/** Typography the mirror copies from the textarea so both layers wrap and align identically. */
const COPIED = [
	'fontFamily',
	'fontSize',
	'fontWeight',
	'fontStyle',
	'lineHeight',
	'letterSpacing',
	'textAlign',
	'paddingTop',
	'paddingBottom',
	'paddingLeft',
	'paddingRight',
] as const;

interface Metrics {
	style: CSSProperties;
	font: string;
	px: number;
}

const advances = new Map<string, number>();
let canvas: HTMLCanvasElement | null = null;

/** Width in px the browser gives an emoji in this font (the same engine lays out the textarea, so it matches). */
function advanceOf(font: string, text: string): number {
	const key = `${font}|${text}`;
	let w = advances.get(key);
	if (w === undefined) {
		canvas ??= document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (ctx) ctx.font = font;
		w = ctx ? ctx.measureText(text).width : 0;
		advances.set(key, w);
	}
	return w;
}

function measure(ta: HTMLTextAreaElement): Metrics {
	const cs = getComputedStyle(ta);
	const style: Record<string, string> = {};
	for (const prop of COPIED) style[prop] = cs[prop];
	return { style: style as CSSProperties, font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, px: parseFloat(cs.fontSize) || 15 };
}

/**
 * A textarea whose emoji are drawn as the selected style's images.
 *
 * A textarea can only draw text, and its value must stay real Unicode (sending, drafts, mentions and copy all rely
 * on it). Some platforms (notably WebView2 on older Windows) cannot draw many emoji natively and show blanks or a
 * bare selection block. So while the text contains emoji and a style is loaded, the textarea's own glyphs are made
 * transparent (the caret and selection stay) and a mirror layer behind-the-text draws the same text with sprites in
 * boxes as wide as the native glyphs, so wrapping and the caret line up. Text without emoji is drawn by the textarea
 * itself, untouched.
 */
export const EmojiTextarea = forwardRef<HTMLTextAreaElement, Props>(function EmojiTextarea(
	{ value, className, style, onScroll, ...rest },
	forwarded,
) {
	const taRef = useRef<HTMLTextAreaElement | null>(null);
	const mirrorRef = useRef<HTMLDivElement>(null);
	const [metrics, setMetrics] = useState<Metrics | null>(null);
	const loaded = useLoadedEmojiStyle();
	const fallbackId = useFallbackStyleId();
	const segments = useMemo(() => mirrorSegments(value), [value]);
	const hasEmoji = segments.some((s) => s.type === 'emoji');
	const active = !!loaded && hasEmoji;
	const fallback = useLoadedEmojiStyle(fallbackId ?? undefined, active && segments.some((s) => s.type === 'emoji' && !loaded?.index.emoji[s.key]));

	const setRefs = useCallback(
		(el: HTMLTextAreaElement | null) => {
			taRef.current = el;
			if (typeof forwarded === 'function') forwarded(el);
			else if (forwarded) forwarded.current = el;
		},
		[forwarded],
	);

	// Typography is measured from the live textarea (breakpoints and themes change it), only while the mirror is in use.
	useLayoutEffect(() => {
		if (!active || !taRef.current) return;
		setMetrics(measure(taRef.current));
	}, [active, value]);

	return (
		<div className="relative min-w-0 flex-1">
			<textarea
				{...rest}
				ref={setRefs}
				value={value}
				className={cn('block w-full', className)}
				style={active ? { ...style, color: 'transparent', WebkitTextFillColor: 'transparent', caretColor: 'hsl(var(--foreground))' } : style}
				onScroll={(e) => {
					if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
					onScroll?.(e);
				}}
			/>
			{active && metrics && (
				<div
					ref={mirrorRef}
					aria-hidden="true"
					dir="auto"
					className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap text-foreground"
					style={{ ...metrics.style, overflowWrap: 'break-word', wordBreak: 'normal' }}
				>
					{segments.map((s, i) => {
						if (s.type === 'text') return s.value;
						const sprite = mirrorEmojiStyle(loaded, fallback, s.key, advanceOf(metrics.font, s.value) || metrics.px * 1.3, metrics.px);
						// Without a sprite the glyph is drawn by the mirror's own text, as the textarea would have.
						return sprite ? <span key={i} style={sprite} /> : s.value;
					})}
				</div>
			)}
		</div>
	);
});
