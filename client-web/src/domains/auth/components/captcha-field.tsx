import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { apiCaptchaChallenge } from '@/api/client';
import { solveChallenge } from '@/lib/altcha';
import { logger } from '@/utils/logger';

interface CaptchaFieldProps {
	/** Called with the solved payload to send as `captcha`, or null while solving or after a failure. */
	onPayload: (payload: string | null) => void;
}

/**
 * Runs the sign-up proof-of-work check (ALTCHA) in the background and shows its progress. There is nothing
 * to click or solve by hand: the client fetches a challenge, does the work and hands the result to the form.
 * Solutions are single use, so the parent remounts this component (change its `key`) after a failed
 * attempt to get a fresh one.
 *
 * @param props see {@link CaptchaFieldProps}.
 */
export function CaptchaField({ onPayload }: CaptchaFieldProps) {
	const { t } = useTranslation();
	const [state, setState] = useState<'solving' | 'done' | 'error'>('solving');
	const [attempt, setAttempt] = useState(0);
	const onPayloadRef = useRef(onPayload);

	useEffect(() => {
		onPayloadRef.current = onPayload;
	}, [onPayload]);

	useEffect(() => {
		const controller = new AbortController();
		onPayloadRef.current(null);
		(async () => {
			try {
				const challenge = await apiCaptchaChallenge();
				const payload = await solveChallenge(challenge, controller.signal);
				if (controller.signal.aborted) return;
				setState('done');
				onPayloadRef.current(payload);
			} catch (err) {
				if (controller.signal.aborted) return;
				logger.error('sign-up check failed', { error: err instanceof Error ? err.message : String(err) });
				setState('error');
			}
		})();
		return () => controller.abort();
	}, [attempt]);

	return (
		<div
			role="status"
			aria-live="polite"
			className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
		>
			{state === 'solving' && (
				<>
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
					{t('captcha.verifying')}
				</>
			)}
			{state === 'done' && (
				<>
					<ShieldCheck className="h-4 w-4 text-success" aria-hidden />
					{t('captcha.verified')}
				</>
			)}
			{state === 'error' && (
				<>
					<ShieldAlert className="h-4 w-4 text-destructive" aria-hidden />
					{t('captcha.failed')}
					<button
						type="button"
						className="font-medium text-primary hover:underline"
						onClick={() => {
							setState('solving');
							setAttempt((n) => n + 1);
						}}
					>
						{t('captcha.retry')}
					</button>
				</>
			)}
		</div>
	);
}
