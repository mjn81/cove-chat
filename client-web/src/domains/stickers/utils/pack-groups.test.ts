import { describe, it, expect } from 'vitest';
import { groupPacks, initialStickerTab, orderedPacks } from './pack-groups';
import type { Pack } from '../types/stickers.types';

const pack = (id: string, scope: Pack['scope'], owner?: string): Pack =>
	({ id, scope, owner_id: owner, name: id, kind: 'sticker', version: 'v1', enabled: true, default: false, order: 0, animated: false, installed: true, editable: false, item_count: 1 }) as Pack;

describe('groupPacks', () => {
	const packs = [pack('cove-basics', 'builtin'), pack('s1', 'server'), pack('u-other', 'user', 'bob'), pack('u-mine', 'user', 'me'), pack('cove-moves', 'builtin')];
	it('separates server, mine and added packs and keeps order inside each', () => {
		const g = groupPacks(packs, 'me');
		expect(g.server.map((p) => p.id)).toEqual(['cove-basics', 's1', 'cove-moves']);
		expect(g.mine.map((p) => p.id)).toEqual(['u-mine']);
		expect(g.installed.map((p) => p.id)).toEqual(['u-other']);
		expect(orderedPacks(g).map((p) => p.id)).toEqual(['cove-basics', 's1', 'cove-moves', 'u-mine', 'u-other']);
	});
	it('treats every user pack as added when the user is unknown', () => {
		expect(groupPacks(packs, undefined).mine).toEqual([]);
	});
});

describe('initialStickerTab', () => {
	const tabs = ['a', 'b', 'c'];
	it('prefers the remembered tab while it exists', () => {
		expect(initialStickerTab(tabs, 'b', 'a', true)).toBe('b');
		expect(initialStickerTab(tabs, 'recent', 'a', true)).toBe('recent');
	});
	it('ignores a remembered tab that is gone', () => {
		expect(initialStickerTab(tabs, 'zzz', 'c', false)).toBe('c');
		expect(initialStickerTab(tabs, 'recent', 'c', false)).toBe('c');
	});
	it('opens recents first when there are some, else the default, else the first', () => {
		expect(initialStickerTab(tabs, null, 'c', true)).toBe('recent');
		expect(initialStickerTab(tabs, null, 'c', false)).toBe('c');
		expect(initialStickerTab(tabs, null, undefined, false)).toBe('a');
		expect(initialStickerTab([], null, undefined, false)).toBeNull();
	});
});
