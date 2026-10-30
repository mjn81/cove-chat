import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { APP_NAME } from '@/lib/brand';
import { unlockApp } from '../api/lock.api';

/** The shell's own wording for a wrong code, so it can be shown translated instead of in English. */
const INCORRECT = 'incorrect passcode';

/**
 * Full-window screen shown while the passcode lock is engaged. Nothing else is rendered until the right code is
 * entered, and a successful unlock reloads the web view so the session and cache are restored from the keystore.
 */
export function LockScreen() {
	const { t } = useTranslation();
	const [code, setCode] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!code || busy) return;
		setBusy(true);
		setError('');
		try {
			await unlockApp(code);
			window.location.reload();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(message.toLowerCase().includes(INCORRECT) ? t('lock.incorrect') : message);
			setCode('');
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-1 items-center justify-center bg-background p-6">
			<form onSubmit={submit} className="flex w-full max-w-[340px] flex-col items-center gap-4 text-center">
				<img src="/cove-icon.svg" alt="" className="h-16 w-16 rounded-2xl" draggable={false} />
				<div>
					<h1 className="flex items-center justify-center gap-2 text-lg font-bold text-foreground">
						<Lock size={16} className="text-muted-foreground" />
						{t('lock.title', { app: APP_NAME })}
					</h1>
					<p className="mt-1 text-xs text-muted-foreground">{t('lock.subtitle')}</p>
				</div>
				<Input
					type="password"
					value={code}
					onChange={(e) => setCode(e.target.value)}
					placeholder={t('lock.placeholder')}
					aria-label={t('lock.placeholder')}
					autoFocus
					autoComplete="off"
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
					className="text-center"
				/>
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				<Button type="submit" className="w-full" disabled={!code || busy}>
					{busy ? <Loader2 size={16} className="animate-spin" /> : t('lock.unlock')}
				</Button>
			</form>
		</div>
	);
}
