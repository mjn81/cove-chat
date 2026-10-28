import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { loadTurnstile } from '@/lib/turnstile';

interface TurnstileWidgetProps {
	/** Public Cloudflare Turnstile key published by the server. */
	siteKey: string;
	/** Called with a fresh token, or null when it expired, errored or was reset. */
	onToken: (token: string | null) => void;
	/** Change this value to discard the current token and show a fresh challenge (tokens are single use). */
	resetKey?: number;
}

/**
 * Renders the Cloudflare Turnstile bot check and reports its token.
 *
 * @param props see {@link TurnstileWidgetProps}.
 */
export function TurnstileWidget({ siteKey, onToken, resetKey = 0 }: TurnstileWidgetProps) {
	const { i18n } = useTranslation();
	const container = useRef<HTMLDivElement>(null);
	// The latest callback is kept in a ref so re-renders never re-create the widget (and its challenge).
	const onTokenRef = useRef(onToken);
	useEffect(() => {
		onTokenRef.current = onToken;
	}, [onToken]);

	useEffect(() => {
		const el = container.current;
		if (!el) return;
		let widgetId: string | null = null;
		let cancelled = false;
		onTokenRef.current(null);

		loadTurnstile()
			.then((api) => {
				if (cancelled) return;
				widgetId = api.render(el, {
					sitekey: siteKey,
					theme: 'auto',
					language: i18n.language,
					callback: (token) => onTokenRef.current(token),
					'expired-callback': () => onTokenRef.current(null),
					'error-callback': () => onTokenRef.current(null),
				});
			})
			.catch(() => onTokenRef.current(null));

		return () => {
			cancelled = true;
			if (widgetId) window.turnstile?.remove(widgetId);
		};
	}, [siteKey, resetKey, i18n.language]);

	return <div ref={container} className="flex min-h-[65px] justify-center" />;
}
