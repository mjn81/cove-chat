import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BotButtonGrid } from './bot-button-grid';

describe('BotButtonGrid', () => {
	it('calls onPress with the custom_id of a callback button', () => {
		const onPress = vi.fn();
		render(<BotButtonGrid rows={[[{ label: 'Yes', custom_id: 'yes', style: 'primary' }]]} onPress={onPress} />);
		fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
		expect(onPress).toHaveBeenCalledWith('yes');
	});

	it('uses the glass style and carries the button style', () => {
		render(<BotButtonGrid rows={[[{ label: 'Stop', custom_id: 'stop', style: 'danger' }]]} onPress={() => undefined} />);
		const btn = screen.getByRole('button', { name: 'Stop' });
		expect(btn.className).toContain('bot-glass');
		expect(btn.getAttribute('data-style')).toBe('danger');
	});

	it('renders URL buttons as safe links and never renders an unsafe one', () => {
		render(
			<BotButtonGrid
				rows={[[{ label: 'Docs', url: 'https://example.com' }, { label: 'Bad', url: 'javascript:alert(1)' }]]}
				onPress={() => undefined}
			/>,
		);
		const link = screen.getByRole('link', { name: /Docs/ });
		expect(link.getAttribute('href')).toBe('https://example.com');
		expect(link.getAttribute('rel')).toContain('noopener');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(screen.queryByText('Bad')).toBeNull();
	});

	it('disables callback buttons while pending or disabled', () => {
		const { rerender } = render(
			<BotButtonGrid rows={[[{ label: 'Go', custom_id: 'go' }]]} onPress={() => undefined} pendingId="go" />,
		);
		expect((screen.getByRole('button', { name: 'Go' }) as HTMLButtonElement).disabled).toBe(true);
		rerender(<BotButtonGrid rows={[[{ label: 'Go', custom_id: 'go' }]]} onPress={() => undefined} disabled />);
		expect((screen.getByRole('button', { name: 'Go' }) as HTMLButtonElement).disabled).toBe(true);
	});
});
