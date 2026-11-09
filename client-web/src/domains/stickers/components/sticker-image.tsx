import { memo } from 'react';

import { useAssetUrl } from '@/lib/asset-cache';
import { cn } from '@/lib/utils';

interface StickerImageProps {
	/** API path of the image (item `url`, or `/api/files/<id>`). */
	path: string | undefined;
	alt: string;
	/** Box size in px; the image keeps its aspect ratio inside it. Ignored with `fill`. */
	size?: number;
	/** Fill the parent box (used by grids whose cells share the row width equally). */
	fill?: boolean;
	className?: string;
}

/**
 * A sticker or pack image fetched through the authenticated asset cache (blob URL, cached in memory and IndexedDB).
 * Animated WebP/GIF play by themselves. While it loads, an empty box of the final size keeps the layout from jumping.
 */
export const StickerImage = memo(function StickerImage({ path, alt, size = 64, fill, className }: StickerImageProps) {
	const src = useAssetUrl(path);
	return src ? (
		<img
			src={src}
			alt={alt}
			draggable={false}
			width={fill ? undefined : size}
			height={fill ? undefined : size}
			className={cn('object-contain', fill && 'h-full w-full', className)}
			style={fill ? undefined : { width: size, height: size }}
		/>
	) : (
		<span aria-hidden="true" className={cn('inline-block animate-pulse rounded-md bg-muted', fill && 'h-full w-full', className)} style={fill ? undefined : { width: size, height: size }} />
	);
});
