/** Options accepted by `turnstile.render` (the subset Cove uses). */
export interface TurnstileRenderOptions {
	sitekey: string;
	theme?: 'auto' | 'light' | 'dark';
	language?: string;
	callback: (token: string) => void;
	'expired-callback'?: () => void;
	'error-callback'?: () => void;
}

/** The slice of the Cloudflare Turnstile browser API that Cove calls. */
export interface TurnstileApi {
	render(container: HTMLElement, options: TurnstileRenderOptions): string;
	reset(widgetId: string): void;
	remove(widgetId: string): void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

/**
 * Loads the Cloudflare Turnstile script once and resolves with its API.
 *
 * @returns the Turnstile API.
 * @throws when the script cannot be loaded (offline, blocked by an extension); callers should show a retry hint.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
	if (window.turnstile) return Promise.resolve(window.turnstile);
	loading ??= new Promise<TurnstileApi>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = SCRIPT_SRC;
		script.async = true;
		script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
		script.onerror = () => {
			loading = null; // allow a retry after a transient failure
			reject(new Error('turnstile script failed to load'));
		};
		document.head.appendChild(script);
	});
	return loading;
}
