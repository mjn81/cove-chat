import React from 'react';

interface ErrorBoundaryProps {
	children: React.ReactNode;
	// Optional label shown in the fallback UI so different boundaries (e.g.
	// wrapping the voice pipeline vs. the whole app) can identify themselves.
	label?: string;
}

interface ErrorBoundaryState {
	error: Error | null;
}

// The app previously had no React error boundaries anywhere: an uncaught
// throw from any component (e.g. the voice audio pipeline's unguarded
// Uint8Array/atob parsing) would blank the entire app to a white screen
// instead of degrading gracefully. This is a generic, reusable boundary —
// wrap the whole app with one, and any risky subtree (e.g. voice chat) with
// its own nested one so a crash there doesn't take out the rest of the UI.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
	}

	private reset = () => {
		this.setState({ error: null });
	};

	render() {
		if (this.state.error) {
			return (
				<div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
					<p className="text-sm font-medium text-foreground">
						Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.
					</p>
					<p className="max-w-md text-xs text-muted-foreground">
						{this.state.error.message}
					</p>
					<button
						type="button"
						onClick={this.reset}
						className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
					>
						Try again
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
