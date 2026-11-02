import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useComposerDrafts } from '@/domains/messages/store/composer-drafts.store';
import { useVoiceStore } from '@/store/voiceStore';
import { isWails } from '@/utils/wails';
import { GetUpdateState, InstallUpdateAndRestart } from '@/wailsjs/go/main/App';
import { EventsOn } from '@/wailsjs/runtime/runtime';
import { useDesktopUpdateStore } from '../store/update.store';
import { parseUpdateState, restartGuard, type RestartGuard } from '../utils/update-state';

/** Name of the Wails event the Go updater emits on every state change. */
const UPDATE_EVENT = 'update:state';

/**
 * Keeps the update store in step with the desktop shell: reads the current state once and then follows the
 * "update:state" event. Mount it once (the app-shell banner does); it does nothing in a browser.
 */
export function useDesktopUpdateSync(): void {
	const setState = useDesktopUpdateStore((s) => s.setState);
	useEffect(() => {
		if (!isWails()) return;
		let cancelled = false;
		GetUpdateState()
			.then((raw) => {
				const parsed = parseUpdateState(raw);
				if (parsed && !cancelled) setState(parsed);
			})
			.catch(() => {
				/* shell without an updater: the banner simply never shows */
			});
		const off = EventsOn(UPDATE_EVENT, (payload: unknown) => {
			const parsed = parseUpdateState(payload);
			if (parsed) setState(parsed);
		});
		return () => {
			cancelled = true;
			off();
		};
	}, [setState]);
}

export interface InstallUpdateControls {
	/** Starts the restart flow: installs at once, or opens the confirmation when a call or draft is open. */
	request: () => void;
	/** Installs without further questions (the confirmation's button). */
	confirm: () => void;
	confirmOpen: boolean;
	setConfirmOpen: (open: boolean) => void;
	/** Why the confirmation is needed; `ok` when it is not. */
	guard: RestartGuard;
	installing: boolean;
}

/**
 * The "Restart to update" action. The updater never restarts by itself: this is the single place a click turns
 * into a restart, and it asks first while a call is running or any chat has an unsent draft.
 */
export function useInstallUpdate(): InstallUpdateControls {
	const { t } = useTranslation();
	const inCall = useVoiceStore((s) => s.activeChannelId !== null);
	const hasDraft = useComposerDrafts((s) => Object.keys(s.drafts).length > 0);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [installing, setInstalling] = useState(false);
	const guard = restartGuard({ inCall, hasDraft });

	const confirm = useCallback(() => {
		setConfirmOpen(false);
		setInstalling(true);
		InstallUpdateAndRestart()
			.catch(() => toast.error(t('desktopUpdate.errors.install_failed')))
			.finally(() => setInstalling(false));
	}, [t]);

	const request = useCallback(() => {
		if (guard === 'ok') confirm();
		else setConfirmOpen(true);
	}, [guard, confirm]);

	return { request, confirm, confirmOpen, setConfirmOpen, guard, installing };
}
