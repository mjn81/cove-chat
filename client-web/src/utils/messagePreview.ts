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

/** The text of a `bot` message body (JSON); empty when it is not one. */
function botText(body: string): string {
	try {
		const parsed: unknown = JSON.parse(body);
		if (typeof parsed === 'object' && parsed !== null && 'text' in parsed && typeof parsed.text === 'string') return parsed.text;
	} catch {
		// Not JSON: nothing to show.
	}
	return '';
}

function bodyForType(type: string, text: string): string {
	if (type === 'text') return truncate(text);
	if (type === 'bot') return truncate(botText(text)) || '[bot]';
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
	const text = type === 'text' || type === 'bot' ? await decryptText(channel.id, ciphertext, nonce) : '';
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
