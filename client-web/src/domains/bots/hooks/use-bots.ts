import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServerCapabilities } from '@/domains/system/api/use-server-capabilities';
import {
	apiCreateBot,
	apiDeleteBot,
	apiDiscoverBots,
	apiInstallBot,
	apiListBots,
	apiListChannelBots,
	apiListChannelCommands,
	apiListChannelKeyboards,
	apiRotateBotToken,
	apiSendInteraction,
	apiUninstallBot,
	apiUpdateBot,
	botKeys,
} from '../api/bots.api';
import type { CreateBotInput, InteractionInput, UpdateBotInput } from '../types/bots.types';

/** Whether this server has the Bot API (capability `bots`); all bot UI is hidden without it. */
export function useBotsSupported(): boolean {
	return useServerCapabilities().supports('bots');
}

/**
 * The caller's bots and creation rights (`can_create`, `max_per_user`).
 *
 * @param all - Server admins only: list every bot of the server.
 */
export function useGetBots(all = false) {
	const supported = useBotsSupported();
	return useQuery({ queryKey: botKeys.mine(all), queryFn: () => apiListBots(all), enabled: supported });
}

/** Public bots that can be installed; `q` is debounced by the caller. */
export function useDiscoverBots(q: string, enabled = true) {
	const supported = useBotsSupported();
	return useQuery({ queryKey: botKeys.discover(q), queryFn: () => apiDiscoverBots(q), enabled: supported && enabled });
}

export function useCreateBot() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateBotInput) => apiCreateBot(input),
		onSuccess: () => qc.invalidateQueries({ queryKey: botKeys.all }),
	});
}

export function useUpdateBot() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, input }: { id: string; input: UpdateBotInput }) => apiUpdateBot(id, input),
		onSuccess: () => qc.invalidateQueries({ queryKey: botKeys.all }),
	});
}

export function useDeleteBot() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => apiDeleteBot(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: botKeys.all }),
	});
}

export function useRotateBotToken() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => apiRotateBotToken(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: botKeys.all }),
	});
}

/** Bots installed in a channel (visible to every member). */
export function useGetChannelBots(channelId: string | undefined) {
	const supported = useBotsSupported();
	return useQuery({
		queryKey: botKeys.channel(channelId ?? ''),
		queryFn: () => apiListChannelBots(channelId!),
		enabled: supported && !!channelId,
	});
}

export function useInstallBot(channelId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ botId, scopes }: { botId: string; scopes: string[] }) => apiInstallBot(channelId, botId, scopes),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: botKeys.channel(channelId) });
			void qc.invalidateQueries({ queryKey: botKeys.commands(channelId) });
		},
	});
}

export function useUninstallBot(channelId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (botId: string) => apiUninstallBot(channelId, botId),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: botKeys.channel(channelId) });
			void qc.invalidateQueries({ queryKey: botKeys.commands(channelId) });
			void qc.invalidateQueries({ queryKey: botKeys.keyboards(channelId) });
		},
	});
}

/** Slash commands usable in the channel, for the composer's autocomplete. */
export function useGetChannelCommands(channelId: string | undefined) {
	const supported = useBotsSupported();
	return useQuery({
		queryKey: botKeys.commands(channelId ?? ''),
		queryFn: () => apiListChannelCommands(channelId!),
		enabled: supported && !!channelId,
		staleTime: 60_000,
	});
}

/** Action menus bots show in the channel; kept live by the `keyboard_update` WebSocket event. */
export function useGetChannelKeyboards(channelId: string | undefined) {
	const supported = useBotsSupported();
	return useQuery({
		queryKey: botKeys.keyboards(channelId ?? ''),
		queryFn: () => apiListChannelKeyboards(channelId!),
		enabled: supported && !!channelId,
		staleTime: Infinity,
	});
}

/** Sends a command, button press or key to a bot. The answer arrives as a normal chat message. */
export function useSendInteraction(channelId: string) {
	return useMutation({ mutationFn: (input: InteractionInput) => apiSendInteraction(channelId, input) });
}
