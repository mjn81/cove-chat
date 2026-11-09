import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBuiltinTheme } from '../data/builtin-themes';
import { createPreviewSession, PREVIEW_TIMEOUT_MS } from './preview-session';
import { createThemeEngine } from './theme-engine';

const nord = getBuiltinTheme('nord')!;
const dracula = getBuiltinTheme('dracula')!;
const cove = getBuiltinTheme('cove')!;

let root: HTMLElement;
beforeEach(() => {
	root = document.createElement('html');
	vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function setup() {
	const engine = createThemeEngine(root);
	engine.apply(cove, 'dark');
	const session = createPreviewSession(engine, () => 'dark');
	return { engine, session };
}

describe('preview session', () => {
	it('shows the theme without applying it and exposes the request', () => {
		const { session } = setup();
		const apply = vi.fn(async () => true);
		session.start({ theme: nord, apply });
		expect(root.style.getPropertyValue('--primary')).toBe(nord.tokens.primary);
		expect(session.current()?.theme.id).toBe('nord');
		expect(apply).not.toHaveBeenCalled();
	});

	it('reverts on demand and clears the request', () => {
		const { session } = setup();
		session.start({ theme: nord, apply: async () => true });
		session.revert();
		expect(session.current()).toBeNull();
		expect(root.style.length).toBe(0); // back to Cove
	});

	it('reverts by itself after 60 seconds', () => {
		const { session } = setup();
		session.start({ theme: nord, apply: async () => true });
		vi.advanceTimersByTime(PREVIEW_TIMEOUT_MS - 1);
		expect(session.current()).not.toBeNull();
		vi.advanceTimersByTime(2);
		expect(session.current()).toBeNull();
		expect(root.style.length).toBe(0);
	});

	it('reports when the preview will end', () => {
		const { session } = setup();
		const now = Date.now();
		session.start({ theme: nord, apply: async () => true });
		expect(session.current()?.expiresAt).toBe(now + PREVIEW_TIMEOUT_MS);
	});

	it('starting another preview replaces the first', () => {
		const { session } = setup();
		session.start({ theme: nord, apply: async () => true });
		session.start({ theme: dracula, apply: async () => true });
		expect(session.current()?.theme.id).toBe('dracula');
		session.revert();
		expect(root.style.length).toBe(0);
	});

	it('apply runs the request, then ends the preview', async () => {
		const { session } = setup();
		const apply = vi.fn(async () => true);
		session.start({ theme: nord, apply });
		expect(await session.apply()).toBe(true);
		expect(apply).toHaveBeenCalledOnce();
		expect(session.current()).toBeNull();
	});

	it('a failed apply keeps the preview running so nothing is lost', async () => {
		const { session } = setup();
		session.start({ theme: nord, apply: async () => false });
		expect(await session.apply()).toBe(false);
		expect(session.current()).not.toBeNull();
	});

	it('an apply that throws is a failure, not an unhandled rejection', async () => {
		const { session } = setup();
		session.start({
			theme: nord,
			apply: async () => {
				throw new Error('disk full');
			},
		});
		expect(await session.apply()).toBe(false);
	});

	it('notifies subscribers on start and end', () => {
		const { session } = setup();
		const listener = vi.fn();
		const off = session.subscribe(listener);
		session.start({ theme: nord, apply: async () => true });
		session.revert();
		expect(listener).toHaveBeenCalledTimes(2);
		off();
		session.start({ theme: nord, apply: async () => true });
		expect(listener).toHaveBeenCalledTimes(2);
	});
});
