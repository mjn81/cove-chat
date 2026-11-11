import type { ChannelCommand, CommandOption } from '../types/bots.types';

/** Most suggestions the autocomplete popup shows. */
export const MAX_SUGGESTIONS = 8;

/**
 * Commands whose name starts with, then merely contains, the typed text, in that order.
 *
 * @param commands - Commands usable in the channel.
 * @param query - What follows the `/` (no spaces).
 */
export function filterCommands(commands: ChannelCommand[], query: string): ChannelCommand[] {
	const q = query.toLowerCase();
	const starts = commands.filter((c) => c.name.startsWith(q));
	const contains = commands.filter((c) => !c.name.startsWith(q) && c.name.includes(q));
	return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

/**
 * The text after a leading `/` while the user is still typing the command name (no space yet); `null` once a space
 * was typed or the text is not a slash command.
 */
export function slashQuery(text: string): string | null {
	const m = /^\/([a-zA-Z0-9_-]*)$/.exec(text);
	return m ? m[1] : null;
}

/** Splits arguments on spaces, keeping "double quoted" and 'single quoted' parts together (also after `name:`). */
export function tokenizeArgs(rest: string): string[] {
	const tokens: string[] = [];
	let cur = '';
	let quote: string | null = null;
	let started = false;
	for (const ch of rest) {
		if (quote) {
			if (ch === quote) quote = null;
			else cur += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			started = true;
		} else if (/\s/.test(ch)) {
			if (started || cur) tokens.push(cur);
			cur = '';
			started = false;
		} else {
			cur += ch;
			started = true;
		}
	}
	if (started || cur) tokens.push(cur);
	return tokens;
}

export type OptionValue = string | number | boolean;

function coerce(option: CommandOption, raw: string, resolveUser?: (name: string) => string | null): OptionValue | null {
	switch (option.type) {
		case 'integer':
			return /^-?\d+$/.test(raw) ? Number(raw) : null;
		case 'number': {
			const n = Number(raw);
			return raw.trim() !== '' && Number.isFinite(n) ? n : null;
		}
		case 'boolean': {
			const v = raw.toLowerCase();
			if (['true', 'yes', 'on', '1'].includes(v)) return true;
			if (['false', 'no', 'off', '0'].includes(v)) return false;
			return null;
		}
		case 'user':
			return resolveUser ? resolveUser(raw.replace(/^@/, '')) : raw;
		default:
			return raw;
	}
}

export type ParsedSlash =
	| { status: 'none' }
	| { status: 'ok'; command: ChannelCommand; options: Record<string, OptionValue> }
	| {
			status: 'error';
			command: ChannelCommand;
			reason: 'missing' | 'invalid' | 'unknown_option' | 'not_a_choice';
			option: string;
	  };

/**
 * Parses `/name arg arg name:value ...` against the channel's commands. Arguments are `option:value` pairs or
 * positional values filled in option order. `/name@bot` picks one bot when two share a command name. Text that does
 * not start with a known command is `none`, so it is sent as an ordinary message.
 *
 * @param text - The composer text.
 * @param commands - Commands usable in the channel.
 * @param resolveUser - Maps a `@username` typed for a `user` option to a user id (null when unknown).
 */
export function parseSlashInput(
	text: string,
	commands: ChannelCommand[],
	resolveUser?: (name: string) => string | null,
): ParsedSlash {
	const m = /^\/([a-zA-Z0-9_-]+)(?:@([a-zA-Z0-9_.-]+))?(?:\s+([\s\S]*))?$/.exec(text.trimEnd());
	if (!m) return { status: 'none' };
	const [, name, botName, rest = ''] = m;
	const command = commands.find(
		(c) => c.name === name.toLowerCase() && (!botName || c.bot_username === botName.toLowerCase()),
	);
	if (!command) return { status: 'none' };
	const options = command.options ?? [];
	const values: Record<string, OptionValue> = {};
	let positional = 0;
	for (const token of tokenizeArgs(rest)) {
		const pair = /^([a-zA-Z0-9_-]+):(.*)$/.exec(token);
		const named = pair ? options.find((o) => o.name === pair[1]) : undefined;
		let option: CommandOption | undefined;
		let raw: string;
		if (named && pair) {
			option = named;
			raw = pair[2];
		} else {
			while (positional < options.length && options[positional].name in values) positional++;
			option = options[positional];
			raw = token;
			if (!option) return { status: 'error', command, reason: 'unknown_option', option: token };
		}
		const value = coerce(option, raw, resolveUser);
		if (value === null) return { status: 'error', command, reason: 'invalid', option: option.name };
		if (option.choices?.length && !option.choices.some((c) => c.value === String(value))) {
			return { status: 'error', command, reason: 'not_a_choice', option: option.name };
		}
		values[option.name] = value;
	}
	for (const o of options) {
		if (o.required && !(o.name in values)) return { status: 'error', command, reason: 'missing', option: o.name };
	}
	return { status: 'ok', command, options: values };
}

/** One-line usage hint such as `/roll <sides> [note]`. */
export function usageLine(command: ChannelCommand): string {
	const opts = (command.options ?? []).map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`));
	return ['/' + command.name, ...opts].join(' ');
}
