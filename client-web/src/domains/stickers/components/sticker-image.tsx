import { memo } from 'react';

import { useAssetUrl } from '@/lib/asset-cache';
import { cn } from '@/lib/utils';

interface StickerImageProps {
	/** API path of the image (item `url`, or `/api/files/<id>`). */
	path: string | undefined;
	alt: string;
	/** Box size in px; the image keeps its aspect ratio inside it. */
	size: number;
	className?: string;
}

/**
 * A sticker or pack image fetched through the authenticated asset cache (blob URL, cached in memory and IndexedDB).
 * Animated WebP/GIF play by themselves. While it loads, an empty box of the final size keeps the layout from jumping.
 */
export const StickerImage = memo(function StickerImage({ path, alt, size, className }: StickerImageProps) {
	const src = useAssetUrl(path);
	return src ? (
		<img
			src={src}
			alt={alt}
			draggable={false}
			width={size}
			height={size}
			className={cn('object-contain', className)}
			style={{ width: size, height: size }}
		/>
	) : (
		<span aria-hidden="true" className={cn('inline-block animate-pulse rounded-md bg-muted', className)} style={{ width: size, height: size }} />
	);
});
