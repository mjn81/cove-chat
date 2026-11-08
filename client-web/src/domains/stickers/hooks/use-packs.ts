import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServerCapabilities } from '@/domains/system/api/use-server-capabilities';
import {
	apiCreatePack,
	apiDeletePack,
	apiDeleteSticker,
	apiGetAttribution,
	apiGetPack,
	apiInstallPack,
	apiListPacks,
	apiRenamePack,
	apiReorderStickers,
	apiUninstallPack,
	apiUploadSticker,
	stickerKeys,
} from '../api/stickers.api';

/** The caller's sticker picker and quota. Disabled (no data) on servers without the `stickers` capability. */
export function usePacks() {
	const { supports } = useServerCapabilities();
	return useQuery({
		queryKey: stickerKeys.packs(),
		queryFn: apiListPacks,
		enabled: supports('stickers'),
		staleTime: 60_000,
	});
}

/**
 * One pack with its items. Built-in and server pack versions change only with a server release, so the detail is
 * cached for a while; mutations on a pack invalidate it.
 *
 * @param id - Pack id, or undefined to load nothing.
 */
export function usePack(id: string | undefined) {
	const { supports } = useServerCapabilities();
	return useQuery({
		queryKey: stickerKeys.pack(id ?? ''),
		queryFn: () => apiGetPack(id!),
		enabled: !!id && supports('stickers'),
		staleTime: 5 * 60_000,
	});
}

/** Credits shown on the attribution page. */
export function useAttribution(enabled = true) {
	return useQuery({ queryKey: stickerKeys.attribution(), queryFn: apiGetAttribution, enabled, staleTime: 60 * 60_000 });
}

/** Builds a mutation that refreshes every sticker query afterwards (packs, details and quota all change together). */
function usePackMutation<V, R>(fn: (v: V) => Promise<R>) {
	const qc = useQueryClient();
	return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: stickerKeys.all }) });
}

export const useCreatePack = () => usePackMutation((v: { name: string; description?: string }) => apiCreatePack(v.name, v.description));
export const useRenamePack = () => usePackMutation((v: { id: string; name: string }) => apiRenamePack(v.id, v.name));
export const useDeletePack = () => usePackMutation((id: string) => apiDeletePack(id));
export const useInstallPack = () => usePackMutation((id: string) => apiInstallPack(id));
export const useUninstallPack = () => usePackMutation((id: string) => apiUninstallPack(id));
export const useUploadSticker = () =>
	usePackMutation((v: { packId: string; file: Blob; emoji?: string; fileName?: string }) =>
		apiUploadSticker(v.packId, v.file, v.emoji, v.fileName),
	);
export const useDeleteSticker = () => usePackMutation((v: { packId: string; itemId: string }) => apiDeleteSticker(v.packId, v.itemId));
export const useReorderStickers = () =>
	usePackMutation((v: { packId: string; itemIds: string[] }) => apiReorderStickers(v.packId, v.itemIds));
