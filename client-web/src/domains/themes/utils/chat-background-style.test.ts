import { describe, expect, it } from 'vitest';
import { getBuiltinTheme } from '../data/builtin-themes';
import type { ThemeDefinition } from '../types/themes.types';
import { chatBackgroundStyle, resolveChatBackground } from './chat-background-style';

const withBg = (background: NonNullable<ThemeDefinition['chat']>['background']): ThemeDefinition => ({
	...getBuiltinTheme('nord')!,
	id: 'with-bg',
	chat: { background },
});

describe('resolveChatBackground', () => {
	it('maps the setting', () => {
		const nord = getBuiltinTheme('nord')!;
		expect(resolveChatBackground('none', nord)).toEqual({ type: 'none' });
		expect(resolveChatBackground('space', nord)).toEqual({ type: 'pattern', pattern: 'space' });
		expect(resolveChatBackground('theme', nord)).toEqual({ type: 'none' });
		expect(resolveChatBackground('theme', withBg({ type: 'color', color: '1 2% 3%' }))).toEqual({ type: 'color', color: '1 2% 3%' });
	});
});

describe('chatBackgroundStyle', () => {
	it('is null when there is nothing to draw', () => {
		expect(chatBackgroundStyle({ type: 'none' }, { strength: 0.05 })).toBeNull();
		expect(chatBackgroundStyle({ type: 'pattern', pattern: 'space' }, { strength: 0.05 })).toBeNull(); // no url yet
		expect(chatBackgroundStyle({ type: 'image', asset: 'assets/a.png', opacity: 1, blur: 0, fit: 'cover' }, { strength: 0.05 })).toBeNull();
	});

	it('draws a pattern as a tinted mask of the foreground token', () => {
		const s = chatBackgroundStyle({ type: 'pattern', pattern: 'space' }, { strength: 0.05, patternUrl: '/p.svg' })!;
		expect(s.maskImage).toBe('url(/p.svg)');
		expect(s.backgroundColor).toBe('hsl(var(--foreground) / 0.05)');
	});

	it('draws colours and gradients from validated triplets', () => {
		expect(chatBackgroundStyle({ type: 'color', color: '210 20% 15%' }, { strength: 0 })!.backgroundColor).toBe('hsl(210 20% 15%)');
		expect(chatBackgroundStyle({ type: 'gradient', from: '10 20% 15%', to: '30 20% 25%', angle: 45 }, { strength: 0 })!.backgroundImage).toBe(
			'linear-gradient(45deg, hsl(10 20% 15%), hsl(30 20% 25%))',
		);
	});

	it('draws an image from a blob URL with fit, opacity and blur', () => {
		const s = chatBackgroundStyle(
			{ type: 'image', asset: 'assets/a.png', opacity: 0.5, blur: 6, fit: 'tile' },
			{ strength: 0, imageUrl: 'blob:abc' },
		)!;
		expect(s.backgroundImage).toBe('url("blob:abc")');
		expect(s.backgroundRepeat).toBe('repeat');
		expect(s.opacity).toBe(0.5);
		expect(s.filter).toBe('blur(6px)');
		const cover = chatBackgroundStyle({ type: 'image', asset: 'a', opacity: 1, blur: 0, fit: 'cover' }, { strength: 0, imageUrl: 'blob:abc' })!;
		expect(cover.backgroundSize).toBe('cover');
		expect(cover.filter).toBeUndefined();
	});

	it('refuses image URLs that are not blob URLs (a theme can never point at the network)', () => {
		const cfg = { type: 'image', asset: 'a', opacity: 1, blur: 0, fit: 'cover' } as const;
		expect(chatBackgroundStyle(cfg, { strength: 0, imageUrl: 'https://evil.example/x.png' })).toBeNull();
		expect(chatBackgroundStyle(cfg, { strength: 0, imageUrl: 'javascript:alert(1)' })).toBeNull();
		expect(chatBackgroundStyle(cfg, { strength: 0, imageUrl: 'blob:abc") ,url("https://evil' })).toBeNull();
	});
});
