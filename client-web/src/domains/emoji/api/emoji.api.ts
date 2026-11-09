import { apiClient, request } from '@/api/client';
import type { AnimatedEmojiResponse, CustomEmojiResponse, EmojiStylesResponse } from '../types/emoji.types';

/** Query keys for the emoji domain; invalidate through these, never by string. */
export const emojiKeys = {
	all: ['emoji'] as const,
	styles: () => ['emoji', 'styles'] as const,
	animated: () => ['emoji', 'animated'] as const,
	custom: () => ['emoji', 'custom'] as const,
	/** A decoded sprite sheet; the version is part of the key, so a new release is a new entry. */
	sheet: (style: string, version: string) => ['emoji', 'sheet', style, version] as const,
};

/** The emoji styles the server offers, with their versioned asset URLs. Needs capability `emoji_packs`. */
export const apiGetEmojiStyles = () => request<EmojiStylesResponse>(apiClient.get('/api/emoji/styles'));

/** The table mapping a single emoji to its big animation. Needs capability `animated_emoji`. */
export const apiGetAnimatedEmoji = () => request<AnimatedEmojiResponse>(apiClient.get('/api/emoji/animated'));

/** The server's custom emoji. Needs capability `custom_emoji`. */
export const apiGetCustomEmoji = () => request<CustomEmojiResponse>(apiClient.get('/api/emoji/custom'));
