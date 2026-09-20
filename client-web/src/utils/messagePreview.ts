import type { Channel } from '@/types/api';
import { decryptText } from '@/ws';
import { isDirectMessage, getChannelDisplayName } from '@/utils/channel';

const MAX_PREVIEW_LENGTH = 60;

function truncate(text: string): string {
	const singleLine = text.replace(/\s+/g, ' ').trim();
	return singleLine.length > MAX_PREVIEW_LENGTH
		? `${singleLine.slice(0, MAX_PREVIEW_LENGTH)}…`
		: singleLine;
}

function bodyForType(type: string, text: string): string {
	if (type === 'text') return truncate(text);
	return `[${type}]`;
}

// Builds a Telegram-style "You: hey" / "Alice: [voice]" sidebar preview.
// Text is decrypted client-side — the backend only ever holds ciphertext.
export async function buildMessagePreview(
	channel: Channel,
	senderId: string,
	type: string,
	ciphertext: string,
	nonce: string,
	currentUserId: string,
): Promise<string> {
	const text = type === 'text' ? await decryptText(channel.id, ciphertext, nonce) : '';
	const body = bodyForType(type, text);

	const prefix =
		senderId === currentUserId
			? 'You'
			: channel.member_names?.[senderId] ||
			  (isDirectMessage(channel)
					? getChannelDisplayName(channel, currentUserId)
					: 'Someone');
	return `${prefix}: ${body}`;
}
