import { describe, it, expect, vi } from 'vitest';
import { hasComposer, insertIntoComposer, registerComposer, sendStickerFromPanel } from './composer-bridge';

const make = () => ({ insert: vi.fn(), sticker: vi.fn() });

describe('composer bridge', () => {
	it('does nothing without a composer', () => {
		expect(hasComposer()).toBe(false);
		expect(() => insertIntoComposer('😀', { keyboard: false })).not.toThrow();
	});

	it('routes panel input to the registered composer', () => {
		const h = make();
		const off = registerComposer(h);
		insertIntoComposer('😀', { keyboard: true });
		sendStickerFromPanel('p', { id: 's' } as never);
		expect(h.insert).toHaveBeenCalledWith('😀', { keyboard: true });
		expect(h.sticker).toHaveBeenCalledWith('p', { id: 's' });
		off();
		expect(hasComposer()).toBe(false);
	});

	it('lets the newest composer win and does not clear a newer registration', () => {
		const a = make();
		const b = make();
		const offA = registerComposer(a);
		const offB = registerComposer(b);
		insertIntoComposer('x', { keyboard: false });
		expect(b.insert).toHaveBeenCalled();
		expect(a.insert).not.toHaveBeenCalled();
		offA();
		expect(hasComposer()).toBe(true);
		offB();
		expect(hasComposer()).toBe(false);
	});
});
