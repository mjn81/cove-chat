import { describe, it, expect } from 'vitest';
import { checkStyleSelection, splitAdminPacks, swapPackOrder, toggleStyle } from './admin-packs';
import type { Pack } from '@/domains/stickers/types/stickers.types';

describe('checkStyleSelection', () => {
	it('needs at least one style and a default among them', () => {
		expect(checkStyleSelection([], 'noto')).toBe('none_enabled');
		expect(checkStyleSelection(['twemoji'], 'noto')).toBe('default_not_enabled');
		expect(checkStyleSelection(['noto', 'twemoji'], 'noto')).toBeNull();
	});
});

describe('toggleStyle', () => {
	const all = ['native', 'noto', 'twemoji', 'blobmoji'];
	it('adds in canonical order', () => {
		expect(toggleStyle(all, ['noto'], 'native', 'noto').enabled).toEqual(['native', 'noto']);
	});
	it('removes and moves the default off a disabled style', () => {
		expect(toggleStyle(all, ['noto', 'twemoji'], 'noto', 'noto')).toEqual({ enabled: ['twemoji'], defaultStyle: 'twemoji' });
	});
	it('keeps a still-valid default', () => {
		expect(toggleStyle(all, ['noto', 'twemoji'], 'twemoji', 'noto').defaultStyle).toBe('noto');
	});
});

describe('swapPackOrder', () => {
	const packs = [
		{ id: 'a', order: 1 },
		{ id: 'b', order: 2 },
		{ id: 'c', order: 3 },
	];
	it('swaps order values with the neighbour', () => {
		expect(swapPackOrder(packs, 1, -1)).toEqual([
			{ id: 'b', order: 1 },
			{ id: 'a', order: 2 },
		]);
		expect(swapPackOrder(packs, 0, 1)).toEqual([
			{ id: 'a', order: 2 },
			{ id: 'b', order: 1 },
		]);
	});
	it('does nothing at the ends', () => {
		expect(swapPackOrder(packs, 0, -1)).toEqual([]);
		expect(swapPackOrder(packs, 2, 1)).toEqual([]);
	});
	it('separates equal order values so the move takes effect', () => {
		const changes = swapPackOrder([{ id: 'a', order: 0 }, { id: 'b', order: 0 }], 1, -1);
		expect(changes[0].order).not.toBe(changes[1].order);
		expect(changes[0].id).toBe('b');
	});
});

describe('splitAdminPacks', () => {
	const p = (id: string, scope: Pack['scope'], order: number, owner = ''): Pack =>
		({ id, scope, order, name: id, owner_name: owner }) as Pack;
	it('separates managed packs (by order) from user packs (by owner)', () => {
		const r = splitAdminPacks([p('u2', 'user', 0, 'zed'), p('s', 'server', 2), p('b', 'builtin', 1), p('u1', 'user', 0, 'amy')]);
		expect(r.managed.map((x) => x.id)).toEqual(['b', 's']);
		expect(r.user.map((x) => x.id)).toEqual(['u1', 'u2']);
	});
});
