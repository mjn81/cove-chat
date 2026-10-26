import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { MediaViewer } from './media-viewer';

describe('MediaViewer', () => {
	afterEach(() => {
		document.documentElement.dir = 'ltr';
	});

	it('renders title, subtitle and media only while open', () => {
		const { rerender } = render(
			<MediaViewer open onOpenChange={() => {}} title="cat.png" subtitle="12 KB">
				<img alt="the cat" />
			</MediaViewer>,
		);
		expect(screen.getByRole('dialog', { name: 'cat.png' })).toBeInTheDocument();
		expect(screen.getByText('12 KB')).toBeInTheDocument();
		expect(screen.getByAltText('the cat')).toBeInTheDocument();

		rerender(
			<MediaViewer open={false} onOpenChange={() => {}} title="cat.png">
				<img alt="the cat" />
			</MediaViewer>,
		);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('closes from the close button', () => {
		const onOpenChange = vi.fn();
		render(
			<MediaViewer open onOpenChange={onOpenChange} title="x">
				<span>media</span>
			</MediaViewer>,
		);
		fireEvent.click(screen.getByRole('button', { name: /close/i }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it('does not close when the media itself is clicked', () => {
		const onOpenChange = vi.fn();
		render(
			<MediaViewer open onOpenChange={onOpenChange} title="x">
				<span>media</span>
			</MediaViewer>,
		);
		fireEvent.click(screen.getByText('media'));
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it('steps with the arrow keys, mirrored in RTL', () => {
		const onPrev = vi.fn();
		const onNext = vi.fn();
		const { unmount } = render(
			<MediaViewer open onOpenChange={() => {}} title="x" onPrev={onPrev} onNext={onNext}>
				<span>media</span>
			</MediaViewer>,
		);
		fireEvent.keyDown(window, { key: 'ArrowRight' });
		expect(onNext).toHaveBeenCalledOnce();
		fireEvent.keyDown(window, { key: 'ArrowLeft' });
		expect(onPrev).toHaveBeenCalledOnce();
		unmount();

		document.documentElement.dir = 'rtl';
		const rtlPrev = vi.fn();
		render(
			<MediaViewer open onOpenChange={() => {}} title="x" onPrev={rtlPrev} onNext={() => {}}>
				<span>media</span>
			</MediaViewer>,
		);
		fireEvent.keyDown(window, { key: 'ArrowRight' });
		expect(rtlPrev).toHaveBeenCalledOnce();
	});

	it('selects a photo from the dots', () => {
		const onSelect = vi.fn();
		render(
			<MediaViewer
				open
				onOpenChange={() => {}}
				title="x"
				position={{ index: 0, total: 3, onSelect }}
			>
				<span>media</span>
			</MediaViewer>,
		);
		fireEvent.click(screen.getAllByRole('button', { name: /profile\.photo_n/ })[2]);
		expect(onSelect).toHaveBeenCalledWith(2);
	});
});
