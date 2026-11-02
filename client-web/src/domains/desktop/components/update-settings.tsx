import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingRow, SwitchRow } from '@/components/setting-row';
import { CheckForUpdate, GetUpdateSettings, SetUpdateSettings } from '@/wailsjs/go/main/App';
import { useInstallUpdate } from '../hooks/use-desktop-update';
import { useDesktopUpdateStore } from '../store/update.store';
import type { DesktopUpdateSettings, DesktopUpdateState } from '../types/update.types';
import { isUpdateBusy, parseUpdateSettings } from '../utils/update-state';
import { RestartConfirmDialog } from './restart-confirm-dialog';

/** One line describing where the updater is, already translated. */
function useStatusText(state: DesktopUpdateState | null): string {
	const { t } = useTranslation();
	if (!state) return t('desktopUpdate.status.unknown');
	switch (state.phase) {
		case 'checking':
			return t('desktopUpdate.status.checking');
		case 'downloading':
			return t('desktopUpdate.status.downloading', {
				version: state.latest_version,
				percent: state.progress_percent,
			});
		case 'installing':
			return t('desktopUpdate.status.installing');
		case 'ready':
			return state.can_install
				? t('desktopUpdate.status.ready', { version: state.latest_version })
				: t('desktopUpdate.status.manual', { version: state.latest_version });
		case 'error':
			return t(`desktopUpdate.errors.${state.error || 'check_failed'}`);
		default:
			return state.checked_at
				? t('desktopUpdate.status.upToDate', { time: new Date(state.checked_at).toLocaleString() })
				: t('desktopUpdate.status.notChecked');
	}
}

/**
 * Update preferences and the manual "Check now" for the desktop app: the background-check and pre-release
 * switches, the current version and status, and a restart button once an update is staged.
 */
export function UpdateSettings() {
	const { t } = useTranslation();
	const state = useDesktopUpdateStore((s) => s.state);
	const install = useInstallUpdate();
	const status = useStatusText(state);
	const [settings, setSettings] = useState<DesktopUpdateSettings | null>(null);

	useEffect(() => {
		GetUpdateSettings()
			.then((raw) => setSettings(parseUpdateSettings(raw)))
			.catch(() => setSettings(null));
	}, []);

	if (!settings) return null;

	const save = (next: DesktopUpdateSettings) => {
		const previous = settings;
		setSettings(next);
		SetUpdateSettings(next.enabled, next.include_prerelease).catch(() => {
			setSettings(previous);
			toast.error(t('desktopSettings.error'));
		});
	};

	return (
		<section className="mt-8" aria-labelledby="desktop-update-title">
			<h3 id="desktop-update-title" className="mb-1 text-lg font-bold text-foreground">
				{t('desktopUpdate.title')}
			</h3>
			<SwitchRow
				title={t('desktopUpdate.auto')}
				description={t('desktopUpdate.autoHint')}
				checked={settings.enabled}
				onCheckedChange={(enabled) => save({ ...settings, enabled })}
			/>
			<SwitchRow
				title={t('desktopUpdate.prerelease')}
				description={t('desktopUpdate.prereleaseHint')}
				checked={settings.include_prerelease}
				onCheckedChange={(include_prerelease) => save({ ...settings, include_prerelease })}
			/>
			<SettingRow
				title={t('desktopUpdate.version', { version: state?.current_version ?? '' })}
				description={status}
			>
				<div className="flex items-center gap-2">
					{state?.phase === 'ready' && state.can_install && (
						<Button size="sm" onClick={install.request} disabled={install.installing}>
							{t('desktopUpdate.banner.restart')}
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={() => void CheckForUpdate()}
						disabled={isUpdateBusy(state)}
					>
						<RefreshCw className={state?.phase === 'checking' ? 'animate-spin' : undefined} />
						{t('desktopUpdate.checkNow')}
					</Button>
				</div>
			</SettingRow>
			<RestartConfirmDialog controls={install} version={state?.latest_version ?? ''} />
		</section>
	);
}
