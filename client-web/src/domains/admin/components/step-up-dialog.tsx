import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/form-field';
import { ModalShell } from '@/components/modal-shell';
import { adminErrorMessage } from '../utils/admin-errors';

export interface StepUpValues {
	password: string;
	passphrase: string;
	file: File | null;
}

export interface StepUpDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Already-translated title and explanation of what is about to happen. */
	title: string;
	description: string;
	confirmLabel: string;
	destructive?: boolean;
	/** When set, the admin must type this exact text before the button enables. */
	phrase?: string;
	/** Asks for an archive passphrase (backups). */
	needsPassphrase?: boolean;
	/** Asks for a backup file to upload (restore). */
	needsFile?: boolean;
	/** Runs the action; a thrown error is shown inside the dialog and keeps it open. */
	onSubmit: (values: StepUpValues) => Promise<void>;
}

/**
 * Password re-entry gate for dangerous admin actions. The backend verifies the
 * password again on every call, so a hijacked session alone cannot wipe or
 * export the server; this dialog is only the UI for that check.
 */
export function StepUpDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	destructive,
	phrase,
	needsPassphrase,
	needsFile,
	onSubmit,
}: StepUpDialogProps) {
	const { t } = useTranslation();
	const [password, setPassword] = useState('');
	const [passphrase, setPassphrase] = useState('');
	const [typed, setTyped] = useState('');
	const [file, setFile] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const ready =
		password.length > 0 &&
		(!phrase || typed === phrase) &&
		(!needsPassphrase || passphrase.length >= 12) &&
		(!needsFile || file !== null);

	const close = (next: boolean) => {
		if (busy) return;
		if (!next) {
			setPassword('');
			setPassphrase('');
			setTyped('');
			setFile(null);
			setError('');
		}
		onOpenChange(next);
	};

	const submit = async () => {
		setBusy(true);
		setError('');
		try {
			await onSubmit({ password, passphrase, file });
			close(false);
		} catch (err) {
			setError(adminErrorMessage(t, err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<ModalShell
			open={open}
			onOpenChange={close}
			title={title}
			description={description}
			size="sm"
			footer={
				<>
					<Button variant="ghost" onClick={() => close(false)} disabled={busy}>
						{t('common.cancel')}
					</Button>
					<Button
						variant={destructive ? 'destructive' : 'default'}
						onClick={submit}
						disabled={!ready || busy}
					>
						{confirmLabel}
					</Button>
				</>
			}
		>
			<form
				className="space-y-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready && !busy) void submit();
				}}
			>
				<FormField label={t('admin.step_up.password')} required>
					{(control) => (
						<Input
							{...control}
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							autoComplete="current-password"
							autoFocus
						/>
					)}
				</FormField>
				{needsFile && (
					<FormField label={t('admin.step_up.file')} required>
						{(control) => (
							<Input
								{...control}
								type="file"
								accept=".cove-backup"
								onChange={(e) => setFile(e.target.files?.[0] ?? null)}
							/>
						)}
					</FormField>
				)}
				{needsPassphrase && (
					<FormField
						label={t('admin.step_up.passphrase')}
						hint={t('admin.step_up.passphrase_hint')}
						required
					>
						{(control) => (
							<Input
								{...control}
								type="password"
								value={passphrase}
								onChange={(e) => setPassphrase(e.target.value)}
								autoComplete="new-password"
							/>
						)}
					</FormField>
				)}
				{phrase && (
					<FormField label={t('admin.step_up.type_to_confirm', { phrase })} required>
						{(control) => (
							<Input
								{...control}
								value={typed}
								onChange={(e) => setTyped(e.target.value)}
								autoComplete="off"
								autoCorrect="off"
								autoCapitalize="off"
								spellCheck={false}
							/>
						)}
					</FormField>
				)}
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
			</form>
		</ModalShell>
	);
}
