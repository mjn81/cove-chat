import { apiClient, request } from '@/api/client';
import type {
	Bot,
	BotKeyboard,
	BotPage,
	ChannelBot,
	ChannelCommand,
	CreateBotInput,
	CreateBotResponse,
	StartBotResult,
	InteractionInput,
	InteractionResult,
	UpdateBotInput,
	UpdateBotResponse,
} from '../types/bots.types';

/** Query keys of the bots domain; invalidate through these, never by string. */
export const botKeys = {
	all: ['bots'] as const,
	mine: (all: boolean) => ['bots', 'mine', all] as const,
	discover: (q: string) => ['bots', 'discover', q] as const,
	channel: (channelId: string) => ['bots', 'channel', channelId] as const,
	commands: (channelId: string) => ['bots', 'commands', channelId] as const,
	keyboards: (channelId: string) => ['bots', 'keyboards', channelId] as const,
};

const enc = encodeURIComponent;

/** My bots (admins may ask for every bot of the server) plus the caller's creation rights. */
export const apiListBots = (all = false) =>
	request<BotPage>(apiClient.get('/api/bots', { params: { limit: 100, ...(all ? { all: 1 } : {}) } }));

/** Public bots a channel admin can install, optionally filtered. */
export const apiDiscoverBots = (q: string) =>
	request<BotPage>(apiClient.get('/api/bots/discover', { params: { limit: 100, ...(q ? { q } : {}) } }));

/** Starts a chat with a public bot (opens or creates the DM and sends the bot a start event). */
export const apiStartBot = (id: string) => request<StartBotResult>(apiClient.post(`/api/bots/${enc(id)}/start`));

export const apiCreateBot = (input: CreateBotInput) => request<CreateBotResponse>(apiClient.post('/api/bots', input));

export const apiUpdateBot = (id: string, input: UpdateBotInput) =>
	request<UpdateBotResponse>(apiClient.patch(`/api/bots/${enc(id)}`, input));

export const apiDeleteBot = (id: string) => request<{ status: string }>(apiClient.delete(`/api/bots/${enc(id)}`));

/** Issues a new token (returned once) and invalidates the old one at once. */
export const apiRotateBotToken = (id: string) =>
	request<{ token: string }>(apiClient.post(`/api/bots/${enc(id)}/token`));

export const apiListChannelBots = (channelId: string) =>
	request<{ items: ChannelBot[] }>(apiClient.get(`/api/channels/${enc(channelId)}/bots`));

export const apiInstallBot = (channelId: string, botId: string, scopes: string[]) =>
	request<ChannelBot>(apiClient.put(`/api/channels/${enc(channelId)}/bots/${enc(botId)}`, { scopes }));

export const apiUninstallBot = (channelId: string, botId: string) =>
	request<{ status: string }>(apiClient.delete(`/api/channels/${enc(channelId)}/bots/${enc(botId)}`));

export const apiListChannelCommands = (channelId: string) =>
	request<{ items: ChannelCommand[] }>(apiClient.get(`/api/channels/${enc(channelId)}/commands`));

export const apiListChannelKeyboards = (channelId: string) =>
	request<{ items: BotKeyboard[] }>(apiClient.get(`/api/channels/${enc(channelId)}/keyboards`));

/** Sends a slash command, a button press or an action-menu key to a bot. */
export const apiSendInteraction = (channelId: string, input: InteractionInput) =>
	request<InteractionResult>(apiClient.post(`/api/channels/${enc(channelId)}/interactions`, input));

export type { Bot };
