import { useEffect, useState } from 'react';
import { dexieThemeStore } from '../api/dexie-theme-store';

/**
 * A blob URL for an image shipped inside an installed theme, revoked when no longer used.
 *
 * @param themeId Id of the installed theme.
 * @param assetPath Archive path of the image (`assets/...`), or `null` to skip.
 * @returns The URL once the image has been read, otherwise `null`.
 */
export function useThemeAssetUrl(themeId: string, assetPath: string | null): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!assetPath) return;
		let revoked: string | null = null;
		let cancelled = false;
		dexieThemeStore
			.get(themeId)
			.then((row) => {
				const asset = row?.assets[assetPath];
				if (!asset || cancelled) return;
				const next = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.mime }));
				revoked = next;
				setUrl(next);
			})
			.catch(() => setUrl(null));
		return () => {
			cancelled = true;
			if (revoked) URL.revokeObjectURL(revoked);
			setUrl(null);
		};
	}, [themeId, assetPath]);
	return url;
}
