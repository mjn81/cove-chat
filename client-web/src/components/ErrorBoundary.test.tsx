import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// The app previously had no React error boundaries anywhere: a single
// component throw (e.g. inside the voice audio pipeline, which does a lot
// of unguarded parsing) would blank the whole app to a white screen instead
// of degrading gracefully.

function Bomb(): never {
	throw new Error('boom');
}

describe('ErrorBoundary', () => {
	it('renders children normally when nothing throws', () => {
		render(
			<ErrorBoundary>
				<div>all good</div>
			</ErrorBoundary>,
		);
		expect(screen.getByText('all good')).toBeInTheDocument();
	});

	it('catches a render error from a descendant and shows a fallback instead of blanking the app', () => {
		// React logs the caught error to console.error — silence it for this test.
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		render(
			<ErrorBoundary>
				<Bomb />
			</ErrorBoundary>,
		);

		expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
		expect(screen.queryByText('all good')).not.toBeInTheDocument();

		consoleSpy.mockRestore();
	});

	it('offers a reset action that re-renders children on the next attempt', () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		let shouldThrow = true;
		function MaybeBomb() {
			if (shouldThrow) throw new Error('boom');
			return <div>recovered</div>;
		}

		const { rerender } = render(
			<ErrorBoundary>
				<MaybeBomb />
			</ErrorBoundary>,
		);
		expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

		shouldThrow = false;
		fireEvent.click(screen.getByRole('button', { name: /try again/i }));
		rerender(
			<ErrorBoundary>
				<MaybeBomb />
			</ErrorBoundary>,
		);

		expect(screen.getByText('recovered')).toBeInTheDocument();
		consoleSpy.mockRestore();
	});
});
