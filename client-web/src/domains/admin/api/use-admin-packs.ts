import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { emojiKeys } from '@/domains/emoji/api/emoji.api';
import { stickerKeys } from '@/domains/stickers/api/stickers.api';
import { adminKeys } from './admin.api';
import {
	adminAddCustomEmoji,
	adminCreatePack,
	adminDeleteCustomEmoji,
	adminDeletePack,
	adminDeleteSticker,
	adminListPacks,
	adminReorderStickers,
	adminUpdatePack,
	adminUploadSticker,
} from './packs-admin.api';

/** Every pack on the server, for the management and moderation lists. */
export const useAdminPacks = () => useQuery({ queryKey: adminKeys.packs(), queryFn: adminListPacks });

/**
 * A mutation that refreshes everything a pack or emoji change can touch: the admin list, the users' pickers and
 * details, and the custom emoji list.
 */
function useAdminPackMutation<V, R>(fn: (v: V) => Promise<R>) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: adminKeys.packs() }),
				qc.invalidateQueries({ queryKey: stickerKeys.all }),
				qc.invalidateQueries({ queryKey: emojiKeys.custom() }),
			]),
	});
}

export const useAdminCreatePack = () => useAdminPackMutation((v: { name: string; description?: string }) => adminCreatePack(v.name, v.description));
export const useAdminUpdatePack = () =>
	useAdminPackMutation((v: { id: string; changes: Parameters<typeof adminUpdatePack>[1] }) => adminUpdatePack(v.id, v.changes));
export const useAdminDeletePack = () => useAdminPackMutation((id: string) => adminDeletePack(id));
export const useAdminUploadSticker = () =>
	useAdminPackMutation((v: { packId: string; file: Blob; emoji?: string; fileName?: string }) =>
		adminUploadSticker(v.packId, v.file, v.emoji, v.fileName),
	);
export const useAdminDeleteSticker = () => useAdminPackMutation((v: { packId: string; itemId: string }) => adminDeleteSticker(v.packId, v.itemId));
export const useAdminReorderStickers = () =>
	useAdminPackMutation((v: { packId: string; itemIds: string[] }) => adminReorderStickers(v.packId, v.itemIds));
export const useAdminAddCustomEmoji = () =>
	useAdminPackMutation((v: { name: string; file: Blob; fileName?: string }) => adminAddCustomEmoji(v.name, v.file, v.fileName));
export const useAdminDeleteCustomEmoji = () => useAdminPackMutation((name: string) => adminDeleteCustomEmoji(name));
