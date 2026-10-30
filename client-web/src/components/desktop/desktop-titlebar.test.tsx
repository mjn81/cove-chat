import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n/index';

const mocks = vi.hoisted(() => ({ isMac: vi.fn() }));

vi.mock('@/utils/wails', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/wails')>()),
	isMac: mocks.isMac,
}));
vi.mock('@/wailsjs/runtime/runtime', () => ({
	WindowIsMaximised: vi.fn().mockResolvedValue(false),
	WindowMinimise: vi.fn(),
	WindowToggleMaximise: vi.fn(),
}));
vi.mock('@/wailsjs/go/main/App', () => ({ CloseWindow: vi.fn() }));

import { DesktopTitleBar } from './desktop-titlebar';

const bar = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('DesktopTitleBar', () => {
	beforeEach(() => mocks.isMac.mockReset());
	afterEach(() => document.documentElement.style.removeProperty('--titlebar-h'));

	it('is a drag handle on macOS and leaves room for the traffic lights', () => {
		mocks.isMac.mockReturnValue(true);
		const { container } = render(<DesktopTitleBar />);

		expect(bar(container).style.getPropertyValue('--wails-draggable')).toBe('drag');
		// The native traffic lights are drawn over the top-left of the web view, so nothing may sit there.
		const spacer = bar(container).firstElementChild as HTMLElement;
		expect(spacer.style.paddingInlineStart).toBe('78px');
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});

	it('shows its own caption buttons, outside the drag area, on Windows and Linux', () => {
		mocks.isMac.mockReturnValue(false);
		const { container } = render(<DesktopTitleBar />);

		expect(bar(container).style.getPropertyValue('--wails-draggable')).toBe('drag');
		const buttons = screen.getAllByRole('button');
		expect(buttons).toHaveLength(3);
		for (const b of buttons) expect(b.style.getPropertyValue('--wails-draggable')).toBe('no-drag');
		expect(Number.parseInt((bar(container).firstElementChild as HTMLElement).style.paddingInlineStart || '0', 10)).toBe(0);
	});

	it('publishes its height so full-height layouts subtract it, and cleans up', () => {
		mocks.isMac.mockReturnValue(true);
		const { container, unmount } = render(<DesktopTitleBar />);

		expect(document.documentElement.style.getPropertyValue('--titlebar-h')).toBe(`${bar(container).style.height}`);
		unmount();
		expect(document.documentElement.style.getPropertyValue('--titlebar-h')).toBe('');
	});

	it('stacks above full-screen overlays so the window can always be dragged and closed', () => {
		mocks.isMac.mockReturnValue(true);
		const { container } = render(<DesktopTitleBar />);

		expect(bar(container).className).toContain('z-[110]');
		expect(bar(container).className).toContain('relative');
	});
});
