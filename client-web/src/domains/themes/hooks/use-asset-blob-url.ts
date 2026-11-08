import { useEffect, useState } from 'react';
import type { ThemeAsset } from '../types/themes.types';

/**
 * A `blob:` URL for image bytes held in memory (an unsaved draft), revoked when the bytes change or the component
 * unmounts.
 *
 * @param asset The image, or `null`.
 */
export function useAssetBlobUrl(asset: ThemeAsset | null): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!asset) {
			setUrl(null);
			return;
		}
		const next = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.mime }));
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [asset]);
	return url;
}
