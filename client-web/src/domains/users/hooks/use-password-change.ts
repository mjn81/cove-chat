import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/store/store';
import { logger } from '@/utils/logger';

/** Minimum length the server enforces for a new password. */
const MIN_PASSWORD_LENGTH = 8;

/** Form state and submit for changing the account password. */
export function usePasswordChange() {
	const { t } = useTranslation();
	const updateUser = useAuthStore((s) => s.updateUser);
	const [oldPassword, setOldPasswordState] = useState('');
	const [newPassword, setNewPasswordState] = useState('');
	const [isUpdating, setIsUpdating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const setOldPassword = useCallback((v: string) => {
		setOldPasswordState(v);
		setError(null);
	}, []);
	const setNewPassword = useCallback((v: string) => {
		setNewPasswordState(v);
		setError(null);
	}, []);

	const submit = useCallback(async () => {
		if (!newPassword || !oldPassword) {
			setError(t('account.both_passwords_required'));
			return;
		}
		if (newPassword.length < MIN_PASSWORD_LENGTH) {
			setError(t('auth.errors.password_length'));
			return;
		}
		setError(null);
		setIsUpdating(true);
		try {
			await updateUser({ password: newPassword, old_password: oldPassword });
			setNewPasswordState('');
			setOldPasswordState('');
		} catch (err) {
			logger.error('Password update failed', { error: String(err) });
			const message = err instanceof Error ? err.message : '';
			setError(
				message === 'invalid current password'
					? t('account.wrong_current_password')
					: message || t('account.password_failed'),
			);
		} finally {
			setIsUpdating(false);
		}
	}, [oldPassword, newPassword, updateUser, t]);

	return { oldPassword, setOldPassword, newPassword, setNewPassword, isUpdating, error, submit };
}
