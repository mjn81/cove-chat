import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/store/store';
import { logger } from '@/utils/logger';
import { DEFAULT_BANNER_COLOR } from '../utils/banner-presets';
import { validateUsername } from '../utils/profile-validation';

/**
 * Editable profile fields (username, bio, banner colour) with dirty tracking,
 * reset and save. Only changed fields are sent to the server.
 */
export function useProfileForm() {
	const { t } = useTranslation();
	const user = useAuthStore((s) => s.user);
	const updateUser = useAuthStore((s) => s.updateUser);

	const [username, setUsernameState] = useState(user?.username || '');
	const [customMsg, setCustomMsg] = useState(user?.custom_msg || '');
	const [bannerColor, setBannerColor] = useState(user?.banner_color || DEFAULT_BANNER_COLOR);
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	// Re-sync when the stored profile changes (saved here, or updated from another device).
	useEffect(() => {
		if (!user) return;
		/* eslint-disable react-hooks/set-state-in-effect */
		setUsernameState(user.username || '');
		setCustomMsg(user.custom_msg || '');
		setBannerColor(user.banner_color || DEFAULT_BANNER_COLOR);
		/* eslint-enable react-hooks/set-state-in-effect */
	}, [user]);

	const savedBanner = user?.banner_color || DEFAULT_BANNER_COLOR;
	const isDirty =
		username.trim() !== (user?.username || '') ||
		customMsg !== (user?.custom_msg || '') ||
		bannerColor !== savedBanner;

	const setUsername = useCallback((value: string) => {
		setUsernameState(value);
		setError(null);
	}, []);

	const reset = useCallback(() => {
		setUsernameState(user?.username || '');
		setCustomMsg(user?.custom_msg || '');
		setBannerColor(user?.banner_color || DEFAULT_BANNER_COLOR);
		setError(null);
	}, [user]);

	/** @returns `true` when the profile was saved (or nothing changed). */
	const save = useCallback(async (): Promise<boolean> => {
		const invalid = validateUsername(username);
		if (invalid) {
			setError(t(invalid === 'empty' ? 'account.username_empty' : 'account.username_short'));
			return false;
		}
		setError(null);
		setIsSaving(true);
		try {
			const payload: { username?: string; custom_msg?: string; banner_color?: string } = {};
			if (username.trim() !== user?.username) payload.username = username.trim();
			if (customMsg !== (user?.custom_msg || '')) payload.custom_msg = customMsg;
			if (bannerColor !== savedBanner) payload.banner_color = bannerColor;
			if (Object.keys(payload).length > 0) await updateUser(payload);
			return true;
		} catch (err) {
			logger.error('Failed to update profile', { error: String(err) });
			const message = err instanceof Error ? err.message : '';
			setError(message === 'username taken' ? t('auth.errors.username_taken') : message || t('account.update_failed'));
			return false;
		} finally {
			setIsSaving(false);
		}
	}, [username, customMsg, bannerColor, savedBanner, user, updateUser, t]);

	return {
		username,
		setUsername,
		customMsg,
		setCustomMsg,
		bannerColor,
		setBannerColor,
		error,
		isDirty,
		isSaving,
		reset,
		save,
	};
}
