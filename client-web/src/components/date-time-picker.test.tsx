import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/i18n';
import { DateTimePicker } from './date-time-picker';

describe('DateTimePicker', () => {
	it('picks a day with the default time', () => {
		const onChange = vi.fn();
		render(<DateTimePicker value={undefined} onChange={onChange} defaultTime={[23, 59]} />);

		fireEvent.click(screen.getByRole('button', { name: /pick date/i }));
		const days = screen.getAllByRole('gridcell');
		const target = days.find((d) => d.textContent === '28' && !d.hasAttribute('data-outside'));
		expect(target).toBeTruthy();
		fireEvent.click(target!.querySelector('button')!);

		expect(onChange).toHaveBeenCalledTimes(1);
		const picked = onChange.mock.calls[0][0] as Date;
		expect([picked.getDate(), picked.getHours(), picked.getMinutes()]).toEqual([28, 23, 59]);
	});

	it('shows the current minute in the minute selector even when off the 5-minute grid', () => {
		render(<DateTimePicker value={new Date(2026, 9, 27, 23, 59)} onChange={() => {}} />);
		fireEvent.click(screen.getAllByRole('button')[0]);
		expect(screen.getByRole('combobox', { name: /minute/i })).toHaveTextContent('59');
		fireEvent.keyDown(document.body, { key: 'Escape' });
	});
});
