import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiSearchUsers } from '@/api/client';
import { useDebounce } from '@/hooks/use-debounce';
import { useUserSearch } from '@/hooks/useUsers';
import { useAuthStore } from '@/store/store';

export interface AddFriendStatus {
	type: 'success' | 'error';
	message: string;
}

/** Pulls the backend's `{ error }` message out of an axios-style error, if present. */
function errorMessage(err: unknown): string | undefined {
	const e = err as { response?: { data?: { error?: string } }; message?: string } | undefined;
	return e?.response?.data?.error || e?.message;
}

/**
 * State and actions behind the "Add friend" panel: debounced user search with
 * live results, and sending a friend request either to a picked result or to
 * whatever username was typed.
 */
export function useAddFriend() {
	const { t } = useTranslation();
	const user = useAuthStore((s) => s.user);
	const relationshipAction = useAuthStore((s) => s.relationshipAction);

	const [username, setUsername] = useState('');
	const [isAdding, setIsAdding] = useState(false);
	const [status, setStatus] = useState<AddFriendStatus | null>(null);
	const debouncedUsername = useDebounce(username.trim(), 300);

	const { data: results = [], isFetching: isSearching } = useUserSearch(
		debouncedUsername,
		user?.username,
	);

	const changeUsername = useCallback((value: string) => {
		setUsername(value);
		setStatus(null);
	}, []);

	const clear = useCallback(() => {
		setUsername('');
		setStatus(null);
	}, []);

	const sendTo = useCallback(
		async (targetId: string, targetName: string) => {
			setIsAdding(true);
			setStatus(null);
			try {
				await relationshipAction(targetId, 'request');
				setStatus({ type: 'success', message: t('friends.request_sent', { name: targetName }) });
			} catch (err) {
				setStatus({ type: 'error', message: errorMessage(err) || t('friends.request_failed') });
			} finally {
				setIsAdding(false);
			}
		},
		[relationshipAction, t],
	);

	/** Form submit: prefer a matching live result, otherwise look the typed name up. */
	const submit = useCallback(async () => {
		const trimmed = username.trim();
		if (!trimmed) return;
		if (trimmed.toLowerCase() === user?.username.toLowerCase()) {
			setStatus({ type: 'error', message: t('friends.cannot_self') });
			return;
		}

		const lower = trimmed.toLowerCase();
		const match = results.find((u) => u.username.toLowerCase() === lower) || results[0];
		if (match) {
			await sendTo(match.id, match.username);
			return;
		}

		setIsAdding(true);
		setStatus(null);
		try {
			const found = await apiSearchUsers(trimmed);
			const target = found.find((u) => u.username.toLowerCase() === lower);
			if (!target) {
				setStatus({ type: 'error', message: t('friends.user_not_found', { name: trimmed }) });
				return;
			}
			await relationshipAction(target.id, 'request');
			setStatus({ type: 'success', message: t('friends.request_sent', { name: target.username }) });
			setUsername('');
		} catch (err) {
			setStatus({ type: 'error', message: errorMessage(err) || t('friends.request_failed') });
		} finally {
			setIsAdding(false);
		}
	}, [username, user?.username, results, relationshipAction, sendTo, t]);

	return {
		username,
		changeUsername,
		clear,
		debouncedUsername,
		results,
		isSearching,
		isAdding,
		status,
		sendTo,
		submit,
	};
}
