import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { EmptyState } from './empty-state';
import { FormField } from './form-field';
import { IconButton } from './icon-button';
import { ListRow } from './list-row';
import { ModalShell } from './modal-shell';
import { SwitchRow } from './setting-row';
import { Input } from './ui/input';

describe('FormField', () => {
	it('links the label to the control and appends the required marker', () => {
		render(
			<FormField label="Username" required>
				{(c) => <Input {...c} />}
			</FormField>,
		);
		const input = screen.getByLabelText(/Username/);
		expect(input).toHaveAttribute('aria-required', 'true');
		expect(screen.getByText('*', { exact: false })).toBeInTheDocument();
	});

	it('shows the error instead of the hint and marks the control invalid', () => {
		render(
			<FormField label="Name" hint="Helpful" error="Too short">
				{(c) => <Input {...c} />}
			</FormField>,
		);
		const input = screen.getByLabelText('Name');
		expect(input).toHaveAttribute('aria-invalid', 'true');
		expect(screen.getByRole('alert')).toHaveTextContent('Too short');
		expect(screen.queryByText('Helpful')).not.toBeInTheDocument();
		expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
	});
});

describe('IconButton', () => {
	it('exposes its label as the accessible name and fires onClick', () => {
		const onClick = vi.fn();
		render(
			<IconButton label="Search" onClick={onClick}>
				<svg />
			</IconButton>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Search' }));
		expect(onClick).toHaveBeenCalledOnce();
	});
});

describe('ListRow', () => {
	it('renders a button with selection state when clickable', () => {
		const onClick = vi.fn();
		render(<ListRow title="Sara" subtitle="online" selected onClick={onClick} />);
		const row = screen.getByRole('button', { name: /Sara/ });
		expect(row).toHaveAttribute('aria-pressed', 'true');
		fireEvent.click(row);
		expect(onClick).toHaveBeenCalledOnce();
	});

	it('renders a static row without onClick', () => {
		render(<ListRow title="Omid" trailing={<span>Admin</span>} />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
		expect(screen.getByText('Admin')).toBeInTheDocument();
	});
});

describe('SwitchRow', () => {
	it('toggles through its labelled switch', () => {
		const onChange = vi.fn();
		render(<SwitchRow title="Sounds" checked={false} onCheckedChange={onChange} />);
		fireEvent.click(screen.getByRole('switch', { name: 'Sounds' }));
		expect(onChange).toHaveBeenCalledWith(true);
	});
});

describe('EmptyState', () => {
	it('renders title, description and action', () => {
		render(<EmptyState title="Nothing here" description="Try again" action={<button>Go</button>} />);
		expect(screen.getByText('Nothing here')).toBeInTheDocument();
		expect(screen.getByText('Try again')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
	});
});

describe('ModalShell', () => {
	it('renders title, body and footer when open and nothing when closed', () => {
		const { rerender } = render(
			<ModalShell open onOpenChange={() => {}} title="Create" footer={<button>Save</button>}>
				<p>Body</p>
			</ModalShell>,
		);
		expect(screen.getByRole('dialog', { name: 'Create' })).toBeInTheDocument();
		expect(screen.getByText('Body')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

		rerender(
			<ModalShell open={false} onOpenChange={() => {}} title="Create">
				<p>Body</p>
			</ModalShell>,
		);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('asks to close via the close button', () => {
		const onOpenChange = vi.fn();
		render(
			<ModalShell open onOpenChange={onOpenChange} title="Create">
				<p>Body</p>
			</ModalShell>,
		);
		fireEvent.click(screen.getByRole('button', { name: /close/i }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
