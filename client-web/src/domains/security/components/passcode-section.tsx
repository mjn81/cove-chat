import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { KeyRound, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormField } from '@/components/form-field';
import { isWails } from '@/utils/wails';
import { lockApp, removePasscode, setAutoLock, setPasscode } from '../api/lock.api';
import { useLockStore } from '../store/lock.store';
import { validateNewPasscode } from '../utils/passcode';

/** Idle timeouts offered for auto-lock, in minutes (0 = never). */
const AUTO_LOCK_OPTIONS = [0, 1, 5, 15, 60] as const;

type Mode = 'idle' | 'set' | 'change' | 'remove';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Settings > Privacy section for the desktop app's local passcode: turn it on, change or remove it, pick the
 * auto-lock timeout, or lock right now. With a passcode, the saved session and the cache key are sealed under a
 * key derived from it, so a copied profile or same-user malware sees only ciphertext while the app is locked.
 * Hidden in the browser build, which has no shell to hold the keys.
 */
export function PasscodeSection() {
	const { t } = useTranslation();
	const status = useLockStore((s) => s.status);
	const refresh = useLockStore((s) => s.refresh);
	const [mode, setMode] = useState<Mode>('idle');
	const [current, setCurrent] = useState('');
	const [next, setNext] = useState('');
	const [repeat, setRepeat] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	if (!isWails()) return null;

	const reset = () => {
		setMode('idle');
		setCurrent('');
		setNext('');
		setRepeat('');
		setError('');
	};

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		if (mode !== 'remove') {
			const problem = validateNewPasscode(next, repeat);
			if (problem) {
				setError(t(`passcode.${problem}`));
				return;
			}
		}
		setBusy(true);
		try {
			if (mode === 'remove') {
				await removePasscode(current);
				toast.success(t('passcode.removed'));
			} else {
				await setPasscode(status.enabled ? current : '', next);
				toast.success(t('passcode.saved'));
			}
			await refresh();
			reset();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	const needsCurrent = mode === 'change' || mode === 'remove';
	const needsNew = mode === 'set' || mode === 'change';

	return (
		<section className="flex flex-col gap-4" aria-labelledby="passcode-title">
			<div className="flex items-start gap-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<KeyRound size={18} />
				</div>
				<div>
					<h3 id="passcode-title" className="text-lg font-bold text-foreground">
						{t('passcode.title')}
					</h3>
					<p className="text-xs text-muted-foreground">{t('passcode.description')}</p>
				</div>
			</div>

			{!status.secure_storage && (
				<p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
					{t('passcode.insecure')}
				</p>
			)}

			{mode === 'idle' ? (
				<div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4">
					{status.enabled ? (
						<>
							<div className="flex flex-wrap gap-2">
								<Button variant="secondary" onClick={() => setMode('change')}>
									{t('passcode.change')}
								</Button>
								<Button variant="secondary" onClick={() => setMode('remove')}>
									{t('passcode.remove')}
								</Button>
								<Button variant="outline" className="gap-2" onClick={() => void lockApp()}>
									<Lock size={14} />
									{t('passcode.lockNow')}
								</Button>
							</div>
							<FormField label={t('passcode.autoLock')}>
								{(control) => (
									<Select
										value={String(status.auto_lock_minutes)}
										onValueChange={async (v) => {
											await setAutoLock(Number(v));
											await refresh();
										}}
									>
										<SelectTrigger {...control}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{AUTO_LOCK_OPTIONS.map((m) => (
												<SelectItem key={m} value={String(m)}>
													{t(`passcode.autoLockOptions.m${m}`)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
							</FormField>
						</>
					) : (
						<Button className="self-start" onClick={() => setMode('set')}>
							{t('passcode.set')}
						</Button>
					)}
				</div>
			) : (
				<form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4">
					{needsCurrent && (
						<FormField label={t('passcode.current')} required>
							{(control) => (
								<Input
									{...control}
									type="password"
									value={current}
									onChange={(e) => setCurrent(e.target.value)}
									autoComplete="off"
									autoFocus
								/>
							)}
						</FormField>
					)}
					{needsNew && (
						<>
							<FormField label={t('passcode.new')} required>
								{(control) => (
									<Input
										{...control}
										type="password"
										value={next}
										onChange={(e) => setNext(e.target.value)}
										autoComplete="off"
										autoFocus={!needsCurrent}
									/>
								)}
							</FormField>
							<FormField label={t('passcode.repeat')} required>
								{(control) => (
									<Input
										{...control}
										type="password"
										value={repeat}
										onChange={(e) => setRepeat(e.target.value)}
										autoComplete="off"
									/>
								)}
							</FormField>
						</>
					)}
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
					<div className="flex gap-2">
						<Button type="submit" disabled={busy}>
							{mode === 'remove' ? t('passcode.remove') : t('passcode.save')}
						</Button>
						<Button type="button" variant="ghost" onClick={reset}>
							{t('common.cancel')}
						</Button>
					</div>
				</form>
			)}
		</section>
	);
}
