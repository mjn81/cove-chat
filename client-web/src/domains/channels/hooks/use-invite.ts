import { useMutation, useQuery } from '@tanstack/react-query';
import { apiJoinChannel, apiPreviewInvite, apiRegenerateInvite } from '@/api/client';

/** Query-key factory for invite previews (keyed by the link code). */
export const inviteKeys = {
	preview: (code: string) => ['invites', code, 'preview'] as const,
};

/**
 * Loads the join card for an invite code.
 *
 * @param code - Invite code from the link, or null to stay idle.
 * @returns A query that never retries: an unknown link will not become valid.
 */
export function useGetInvitePreview(code: string | null) {
	return useQuery({
		queryKey: inviteKeys.preview(code ?? ''),
		queryFn: () => apiPreviewInvite(code as string),
		enabled: !!code,
		retry: false,
	});
}

/** Joins a channel by invite code; resolves with the joined channel. */
export function useJoinInvite() {
	return useMutation({ mutationFn: (code: string) => apiJoinChannel(code) });
}

/** Rotates a channel's invite link (admin+); resolves with the updated channel. */
export function useRegenerateInvite() {
	return useMutation({ mutationFn: (channelId: string) => apiRegenerateInvite(channelId) });
}
