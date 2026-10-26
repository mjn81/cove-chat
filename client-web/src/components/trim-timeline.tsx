// guardrail-allow physicalClass: the timeline is forced left-to-right (dir="ltr"), so physical offsets match the media direction.
import * as React from 'react';

import { cn } from '@/lib/utils';

interface TrimTimelineProps {
	/** Bar heights in percent; for audio these are waveform peaks, for video neutral ticks. */
	bars: number[];
	/** Kept range and playhead as 0-1 fractions of the total duration. */
	startRatio: number;
	endRatio: number;
	playheadRatio: number;
	/** Forwarded so the owner can measure the element when dragging. */
	timelineRef: React.RefObject<HTMLDivElement | null>;
	onBeginDrag: (handle: 'start' | 'end', e: React.PointerEvent) => void;
	onPointerMove: (e: React.PointerEvent) => void;
	onPointerUp: (e: React.PointerEvent) => void;
	/** Click on the track (not a handle): seek to that x position. */
	onSeek: (clientX: number) => void;
	startHandleLabel: string;
	endHandleLabel: string;
	className?: string;
}

/**
 * Draggable two-handle trim bar shared by the voice and video recorders:
 * dimmed cut-off regions, highlighted kept window, playhead and a bar strip.
 * Always left-to-right because time flows that way even in RTL layouts.
 */
export const TrimTimeline = ({
	bars,
	startRatio,
	endRatio,
	playheadRatio,
	timelineRef,
	onBeginDrag,
	onPointerMove,
	onPointerUp,
	onSeek,
	startHandleLabel,
	endHandleLabel,
	className,
}: TrimTimelineProps) => (
	<div
		dir="ltr"
		ref={timelineRef}
		onPointerMove={onPointerMove}
		onPointerUp={onPointerUp}
		onClick={(e) => onSeek(e.clientX)}
		className={cn(
			'relative flex h-9 cursor-pointer items-center overflow-hidden rounded border border-border/40 bg-background/40 px-1',
			className,
		)}
	>
		<div
			className="pointer-events-none absolute inset-y-0 left-0 z-10 bg-overlay/40"
			style={{ width: `${startRatio * 100}%` }}
		/>
		<div
			className="pointer-events-none absolute inset-y-0 z-10 border-y-2 border-primary/60 bg-primary/10"
			style={{ left: `${startRatio * 100}%`, width: `${(endRatio - startRatio) * 100}%` }}
		/>
		<div
			className="pointer-events-none absolute inset-y-0 right-0 z-10 bg-overlay/40"
			style={{ width: `${(1 - endRatio) * 100}%` }}
		/>
		<div
			className="pointer-events-none absolute inset-y-0 z-20 w-[2px] bg-foreground"
			style={{ left: `${playheadRatio * 100}%` }}
		/>

		<div className="flex h-full w-full items-center justify-between gap-[2px] px-1">
			{bars.map((height, idx) => {
				const ratio = idx / bars.length;
				const inside = ratio >= startRatio && ratio <= endRatio;
				return (
					<div
						key={idx}
						className={cn('flex-1 rounded-full transition-colors', inside ? 'bg-primary' : 'bg-muted-foreground/30')}
						style={{ height: `${height}%` }}
					/>
				);
			})}
		</div>

		{(['start', 'end'] as const).map((handle) => (
			<div
				key={handle}
				onPointerDown={(e) => onBeginDrag(handle, e)}
				onClick={(e) => e.stopPropagation()}
				style={{ left: `${(handle === 'start' ? startRatio : endRatio) * 100}%` }}
				className="group absolute inset-y-0 z-30 -ml-1.5 flex w-3 cursor-ew-resize touch-none items-center justify-center"
				title={handle === 'start' ? startHandleLabel : endHandleLabel}
			>
				<div className="h-6 w-1.5 rounded-full bg-primary transition-transform group-hover:scale-110" />
			</div>
		))}
	</div>
);
