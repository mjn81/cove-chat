import type { ScreenShareSettings } from '@/store/voiceStore';

/** Result of fitting equal-sized tiles into a box. All sizes are in CSS pixels. */
export interface GridFit {
	cols: number;
	rows: number;
	width: number;
	height: number;
}

/** Widest a single call tile is allowed to grow, so a 1:1 call does not become a wall of video. */
const MAX_TILE_WIDTH = 960;

/**
 * Size the largest equal tiles of a fixed aspect ratio that fit `count` of them inside a `width` x `height` box.
 *
 * Tiles never stretch: every candidate column count is evaluated and the one that yields the widest tile at the
 * requested ratio wins (the Google Meet / Discord approach), so the grid is always a centred block of true 16:9 tiles
 * rather than cells that fill the container.
 *
 * @param count - number of tiles
 * @param width - available width
 * @param height - available height
 * @param gap - space between tiles
 * @param ratio - tile width / height
 * @returns the winning column/row count and the per-tile size (zeros when nothing fits)
 */
export function fitGrid(count: number, width: number, height: number, gap = 12, ratio = 16 / 9): GridFit {
	if (count <= 0 || width <= 0 || height <= 0) return { cols: 0, rows: 0, width: 0, height: 0 };

	let best: GridFit = { cols: 1, rows: count, width: 0, height: 0 };
	for (let cols = 1; cols <= count; cols++) {
		const rows = Math.ceil(count / cols);
		const byWidth = (width - gap * (cols - 1)) / cols;
		const byHeight = ((height - gap * (rows - 1)) / rows) * ratio;
		const tileW = Math.floor(Math.min(byWidth, byHeight, MAX_TILE_WIDTH));
		if (tileW > best.width) {
			best = { cols, rows, width: tileW, height: Math.floor(tileW / ratio) };
		}
	}
	if (best.width <= 0) return { cols: 0, rows: 0, width: 0, height: 0 };
	return best;
}

/** Quality presets offered for screen sharing (replaces four separate resolution / fps / aspect / hint pickers). */
export const STREAM_PRESETS = {
	smooth: { resolution: '720p', frameRate: 60, contentHint: 'motion', aspectRatio: 'source' },
	balanced: { resolution: '1080p', frameRate: 30, contentHint: 'detail', aspectRatio: 'source' },
	sharp: { resolution: 'source', frameRate: 30, contentHint: 'detail', aspectRatio: 'source' },
} as const satisfies Record<string, Partial<ScreenShareSettings>>;

export type StreamPresetId = keyof typeof STREAM_PRESETS;

/**
 * Find which preset the current screen share settings correspond to.
 *
 * @returns the preset id, or `null` when the settings were customised outside the presets
 */
export function matchStreamPreset(settings: ScreenShareSettings): StreamPresetId | null {
	for (const [id, preset] of Object.entries(STREAM_PRESETS) as [StreamPresetId, Partial<ScreenShareSettings>][]) {
		if (
			settings.resolution === preset.resolution &&
			settings.frameRate === preset.frameRate &&
			settings.contentHint === preset.contentHint
		) {
			return id;
		}
	}
	return null;
}
