import type { BotButton, BotButtonStyle, BotMessageBody } from '../types/bots.types';

const STYLES: readonly BotButtonStyle[] = ['primary', 'secondary', 'danger'];

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Only http(s) links are ever opened from a button; anything else (javascript:, data:) is dropped. */
export function isSafeButtonUrl(raw: string): boolean {
	try {
		const u = new URL(raw);
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
}

function parseButton(v: unknown): BotButton | null {
	if (!isRecord(v) || typeof v.label !== 'string' || v.label.trim() === '') return null;
	const customId = typeof v.custom_id === 'string' && v.custom_id !== '' ? v.custom_id : undefined;
	const url = typeof v.url === 'string' && v.url !== '' ? v.url : undefined;
	if ((customId === undefined) === (url === undefined)) return null;
	if (url !== undefined && !isSafeButtonUrl(url)) return null;
	const style = STYLES.includes(v.style as BotButtonStyle) ? (v.style as BotButtonStyle) : 'secondary';
	return { label: v.label, style, custom_id: customId, url, disabled: v.disabled === true };
}

/**
 * Parses the decrypted body of a `bot` message. The server validates bodies it accepts, but this is the trust
 * boundary on the client: unknown fields are ignored, malformed buttons dropped, unsafe links removed.
 *
 * @param text - The decrypted JSON text.
 * @returns The text and button grid, or `null` when the body is not a bot message body at all.
 */
export function parseBotMessage(text: string | undefined): BotMessageBody | null {
	if (!text) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(raw) || typeof raw.text !== 'string') return null;
	const rows: BotButton[][] = [];
	if (Array.isArray(raw.buttons)) {
		for (const row of raw.buttons.slice(0, 5)) {
			if (!Array.isArray(row)) continue;
			const buttons = row.slice(0, 5).map(parseButton).filter((b): b is BotButton => b !== null);
			if (buttons.length > 0) rows.push(buttons);
		}
	}
	return { v: typeof raw.v === 'number' ? raw.v : 1, text: raw.text, buttons: rows };
}

/** Plain-text form of a bot message for previews and quoting. */
export function botMessagePreview(text: string | undefined): string {
	return parseBotMessage(text)?.text ?? '';
}
