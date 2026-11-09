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
		if (!asset) return;
		const next = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.mime }));
		// An object URL is an external resource that must be created and revoked in step with the bytes.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [asset]);
	return asset ? url : null;
}
