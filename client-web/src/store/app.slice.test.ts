import { beforeEach, describe, expect, it } from 'vitest';
import { getBuiltinTheme } from '@/domains/themes/data/builtin-themes';
import type { ThemeDefinition } from '@/domains/themes/types/themes.types';
import { useAppStore } from './app.slice';

const KEY = 'app-settings';

async function loadFromStorage(value: unknown) {
	localStorage.setItem(KEY, JSON.stringify(value));
	await useAppStore.persist.rehydrate();
}

beforeEach(() => {
	localStorage.clear();
	useAppStore.setState({ mode: 'dark', theme: 'dark', themeId: 'cove', customTheme: null, chatBackground: 'none' });
});

describe('persisted settings migration', () => {
	it('keeps an existing light user light, on Cove, with their wallpaper', async () => {
		await loadFromStorage({ state: { theme: 'light', chatBackground: 'space', preferredMicId: 'abc' }, version: 0 });
		const s = useAppStore.getState();
		expect(s.mode).toBe('light');
		expect(s.theme).toBe('light');
		expect(s.themeId).toBe('cove');
		expect(s.customTheme).toBeNull();
		expect(s.chatBackground).toBe('space');
		expect(s.preferredMicId).toBe('abc');
	});

	it('keeps an existing dark user dark', async () => {
		await loadFromStorage({ state: { theme: 'dark' }, version: 0 });
		expect(useAppStore.getState().theme).toBe('dark');
	});

	it('repairs an invalid legacy wallpaper', async () => {
		await loadFromStorage({ state: { theme: 'dark', chatBackground: 'bogus' }, version: 0 });
		expect(useAppStore.getState().chatBackground).toBe('none');
	});

	it('loads current-version settings and re-validates a stored custom theme', async () => {
		const nord = getBuiltinTheme('nord')!;
		const custom: ThemeDefinition = { id: 'mine-one', name: { en: 'Mine' }, base: 'dark', tokens: nord.tokens };
		await loadFromStorage({ state: { mode: 'light', themeId: 'mine-one', customTheme: custom }, version: 1 });
		expect(useAppStore.getState().customTheme?.id).toBe('mine-one');
		// Dark-only custom theme in light mode: the on-screen appearance stays dark.
		expect(useAppStore.getState().mode).toBe('light');
		expect(useAppStore.getState().theme).toBe('dark');

		const tampered = { ...custom, tokens: { ...custom.tokens, primary: 'url(x)' } };
		await loadFromStorage({ state: { mode: 'dark', themeId: 'mine-one', customTheme: tampered }, version: 1 });
		expect(useAppStore.getState().themeId).toBe('cove');
		expect(useAppStore.getState().customTheme).toBeNull();
	});

	it('writes the new shape and no longer the old `theme` field', async () => {
		useAppStore.getState().setMode('light');
		const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { state: Record<string, unknown>; version: number };
		expect(stored.version).toBe(1);
		expect(stored.state.mode).toBe('light');
		expect(stored.state).not.toHaveProperty('theme');
	});
});

describe('actions', () => {
	it('selectTheme switches theme and derives the on-screen mode', () => {
		useAppStore.getState().setMode('light');
		useAppStore.getState().selectTheme(getBuiltinTheme('dracula')!);
		expect(useAppStore.getState().themeId).toBe('dracula');
		expect(useAppStore.getState().theme).toBe('dark');
		useAppStore.getState().selectTheme(getBuiltinTheme('nord')!);
		expect(useAppStore.getState().theme).toBe('light');
	});

	it('stores only installed themes as a snapshot', () => {
		useAppStore.getState().selectTheme(getBuiltinTheme('nord')!);
		expect(useAppStore.getState().customTheme).toBeNull();
		const custom: ThemeDefinition = { id: 'mine-two', name: { en: 'M' }, base: 'dark', tokens: getBuiltinTheme('nord')!.tokens };
		useAppStore.getState().selectTheme(custom);
		expect(useAppStore.getState().customTheme).toEqual(custom);
	});

	it('adopts a theme background and drops it again on the next theme', () => {
		const withBg: ThemeDefinition = {
			id: 'bg-theme', name: { en: 'B' }, base: 'dark', tokens: getBuiltinTheme('nord')!.tokens,
			chat: { background: { type: 'color', color: '220 16% 20%' } },
		};
		useAppStore.getState().selectTheme(withBg);
		expect(useAppStore.getState().chatBackground).toBe('theme');
		useAppStore.getState().selectTheme(getBuiltinTheme('cove')!);
		expect(useAppStore.getState().chatBackground).toBe('none');
	});
});
