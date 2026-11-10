import { describe, expect, it } from 'vitest';

import type { ChannelCommand } from '../types/bots.types';
import { filterCommands, parseSlashInput, slashQuery, tokenizeArgs, usageLine } from './slash-command';

const cmd = (name: string, bot = 'dice', options: ChannelCommand['options'] = []): ChannelCommand => ({
	bot_id: bot + '-id',
	bot_username: bot,
	name,
	description: name,
	options,
});

const roll = cmd('roll', 'dice', [
	{
		name: 'sides',
		description: 'n',
		type: 'integer',
		required: true,
		choices: [
			{ name: 'd6', value: '6' },
			{ name: 'd20', value: '20' },
		],
	},
	{ name: 'loud', description: 'l', type: 'boolean' },
	{ name: 'note', description: 'n', type: 'string' },
]);
const ping = cmd('ping');

describe('slashQuery', () => {
	it('is the name typed so far, only before any space', () => {
		expect(slashQuery('/')).toBe('');
		expect(slashQuery('/ro')).toBe('ro');
		expect(slashQuery('/roll ')).toBeNull();
		expect(slashQuery('hello /x')).toBeNull();
		expect(slashQuery('')).toBeNull();
	});
});

describe('filterCommands', () => {
	it('puts prefix matches first and caps the list', () => {
		const cs = [cmd('reroll'), cmd('roll'), cmd('rock'), cmd('ping')];
		expect(filterCommands(cs, 'ro').map((c) => c.name)).toEqual(['roll', 'rock', 'reroll']);
		expect(filterCommands(cs, '').length).toBe(4);
		expect(filterCommands(Array.from({ length: 20 }, (_, i) => cmd('c' + i)), 'c')).toHaveLength(8);
	});
});

describe('tokenizeArgs', () => {
	it('keeps quoted parts together', () => {
		expect(tokenizeArgs('a "b c" note:"x y" \'z w\'')).toEqual(['a', 'b c', 'note:x y', 'z w']);
		expect(tokenizeArgs('   ')).toEqual([]);
		expect(tokenizeArgs('""')).toEqual(['']);
	});
});

describe('parseSlashInput', () => {
	const cmds = [roll, ping];

	it('treats unknown commands and plain text as ordinary messages', () => {
		expect(parseSlashInput('hello', cmds)).toEqual({ status: 'none' });
		expect(parseSlashInput('/shrug', cmds)).toEqual({ status: 'none' });
		expect(parseSlashInput('/', cmds)).toEqual({ status: 'none' });
	});

	it('parses a command without options', () => {
		expect(parseSlashInput('/ping', cmds)).toEqual({ status: 'ok', command: ping, options: {} });
	});

	it('fills options by name and by position, with types', () => {
		const r = parseSlashInput('/roll 20 loud:yes note:"big one"', cmds);
		expect(r).toEqual({ status: 'ok', command: roll, options: { sides: 20, loud: true, note: 'big one' } });
		expect(parseSlashInput('/roll sides:6', cmds)).toMatchObject({ status: 'ok', options: { sides: 6 } });
	});

	it('reports missing, invalid and out-of-choice values', () => {
		expect(parseSlashInput('/roll', cmds)).toMatchObject({ status: 'error', reason: 'missing', option: 'sides' });
		expect(parseSlashInput('/roll abc', cmds)).toMatchObject({ status: 'error', reason: 'invalid', option: 'sides' });
		expect(parseSlashInput('/roll 7', cmds)).toMatchObject({ status: 'error', reason: 'not_a_choice', option: 'sides' });
		expect(parseSlashInput('/roll 6 yes extra more', cmds)).toMatchObject({ status: 'error', reason: 'unknown_option' });
	});

	it('picks a bot with /name@bot when two bots share a name', () => {
		const other = cmd('ping', 'other');
		const r = parseSlashInput('/ping@other', [ping, other]);
		expect(r).toMatchObject({ status: 'ok' });
		expect(r.status === 'ok' && r.command.bot_username).toBe('other');
		expect(parseSlashInput('/ping@nobody', [ping, other])).toEqual({ status: 'none' });
	});

	it('resolves user options through the callback', () => {
		const hug = cmd('hug', 'b', [{ name: 'who', description: 'w', type: 'user', required: true }]);
		const r = parseSlashInput('/hug @alice', [hug], (n) => (n === 'alice' ? 'id-1' : null));
		expect(r).toMatchObject({ status: 'ok', options: { who: 'id-1' } });
		expect(parseSlashInput('/hug @bob', [hug], () => null)).toMatchObject({ status: 'error', reason: 'invalid' });
	});
});

describe('usageLine', () => {
	it('marks required and optional options', () => {
		expect(usageLine(roll)).toBe('/roll <sides> [loud] [note]');
		expect(usageLine(ping)).toBe('/ping');
	});
});
