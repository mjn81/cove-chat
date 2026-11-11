import { useCallback, useMemo, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Channel } from '@/types/api';
import type { ChannelCommand } from '../types/bots.types';
import { filterCommands, parseSlashInput, slashQuery, usageLine } from '../utils/slash-command';
import { errorText } from './use-bot-interaction';
import { useGetChannelCommands, useSendInteraction } from './use-bots';

/** What `run` did with the composer text. */
export type SlashRun = 'none' | 'handled';

/**
 * Slash commands in the composer: the `/` autocomplete popup and running a typed command as an interaction.
 *
 * @param channel - The channel being typed in (its commands and members are used).
 * @param text - The current composer text.
 * @returns Popup state (`isOpen`, `matches`, `selectedIndex`), keyboard handling, `pick` (the text to insert for a
 * chosen command), `hint` (usage of the command being typed) and `run` (sends the command; `none` when the text is
 * not a known command and should be sent as a normal message).
 */
export function useSlashCommands(channel: Channel, text: string) {
	const { t } = useTranslation();
	const { data } = useGetChannelCommands(channel.id);
	const commands = useMemo(() => data?.items ?? [], [data]);
	const interaction = useSendInteraction(channel.id);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [dismissedFor, setDismissedFor] = useState<string | null>(null);

	const query = slashQuery(text);
	const matches = useMemo(
		() => (query === null || commands.length === 0 ? [] : filterCommands(commands, query)),
		[query, commands],
	);
	const isOpen = matches.length > 0 && dismissedFor !== text;
	const index = Math.min(selectedIndex, Math.max(matches.length - 1, 0));

	const hint = useMemo(() => {
		const m = /^\/([a-zA-Z0-9_-]+)(?:@[a-zA-Z0-9_.-]+)?\s/.exec(text);
		if (!m) return null;
		const c = commands.find((x) => x.name === m[1].toLowerCase());
		return c && (c.options?.length ?? 0) > 0 ? usageLine(c) : null;
	}, [text, commands]);

	const resolveUser = useCallback(
		(name: string) => {
			const entry = Object.entries(channel.member_names ?? {}).find(([, n]) => n.toLowerCase() === name.toLowerCase());
			return entry ? entry[0] : null;
		},
		[channel.member_names],
	);

	/** The composer text after choosing a command; `/name@bot` when two bots offer the same name. */
	const pick = useCallback(
		(c: ChannelCommand): string => {
			const clash = commands.some((o) => o.name === c.name && o.bot_id !== c.bot_id);
			return `/${c.name}${clash ? `@${c.bot_username}` : ''} `;
		},
		[commands],
	);

	const handleKey = useCallback(
		(e: React.KeyboardEvent<HTMLElement>): 'handled' | { pick: ChannelCommand } | undefined => {
			if (!isOpen) return undefined;
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					setSelectedIndex((index + 1) % matches.length);
					return 'handled';
				case 'ArrowUp':
					e.preventDefault();
					setSelectedIndex((index - 1 + matches.length) % matches.length);
					return 'handled';
				case 'Enter':
				case 'Tab':
					e.preventDefault();
					return { pick: matches[index] };
				case 'Escape':
					e.preventDefault();
					setDismissedFor(text);
					return 'handled';
				default:
					return undefined;
			}
		},
		[isOpen, matches, index, text],
	);

	const run = useCallback(
		async (input: string): Promise<SlashRun> => {
			const parsed = parseSlashInput(input, commands, resolveUser);
			if (parsed.status === 'none') return 'none';
			if (parsed.status === 'error') {
				const key = { missing: 'error_missing', invalid: 'error_invalid', unknown_option: 'error_unknown', not_a_choice: 'error_choice' }[parsed.reason];
				toast.error(t(`bots.composer.${key}`, { option: parsed.option }), { description: usageLine(parsed.command) });
				return 'handled';
			}
			try {
				const res = await interaction.mutateAsync({
					type: 'command',
					bot_id: parsed.command.bot_id,
					command: parsed.command.name,
					options: parsed.options,
				});
				if (!res.delivered) toast.error(t('bots.composer.offline', { bot: parsed.command.bot_username }));
			} catch (err) {
				toast.error(errorText(err, t('bots.composer.failed')));
			}
			return 'handled';
		},
		[commands, resolveUser, interaction, t],
	);

	return { isOpen, matches, selectedIndex: index, setSelectedIndex, handleKey, pick, hint, run, hasCommands: commands.length > 0 };
}
