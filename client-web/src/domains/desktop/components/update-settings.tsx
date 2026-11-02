import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingRow, SwitchRow } from '@/components/setting-row';
import { CheckForUpdate, DownloadUpdate, GetUpdateSettings, SetUpdateSettings } from '@/wailsjs/go/main/App';
import { useInstallUpdate } from '../hooks/use-desktop-update';
import { useDesktopUpdateStore } from '../store/update.store';
import type { DesktopUpdateSettings, DesktopUpdateState } from '../types/update.types';
import { DEFAULT_MANIFEST_URL, isUpdateBusy, parseUpdateSettings } from '../utils/update-state';
import { RestartConfirmDialog } from './restart-confirm-dialog';

/** One line describing where the updater is, already translated. */
function useStatusText(state: DesktopUpdateState | null): string {
	const { t } = useTranslation();
	if (!state) return t('desktopUpdate.status.unknown');
	switch (state.phase) {
		case 'checking':
			return t('desktopUpdate.status.checking');
		case 'available':
			return t('desktopUpdate.status.available', { version: state.latest_version });
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
 * Update preferences and the manual actions for the desktop app: background checks, pre-releases, the opt-in
 * automatic download, the update source, the current version and status, and Check now / Download / Restart.
 */
export function UpdateSettings() {
	const { t } = useTranslation();
	const state = useDesktopUpdateStore((s) => s.state);
	const install = useInstallUpdate();
	const status = useStatusText(state);
	const [settings, setSettings] = useState<DesktopUpdateSettings | null>(null);
	const [source, setSource] = useState('');

	useEffect(() => {
		GetUpdateSettings()
			.then((raw) => {
				const parsed = parseUpdateSettings(raw);
				setSettings(parsed);
				setSource(parsed?.manifest_url ?? '');
			})
			.catch(() => setSettings(null));
	}, []);

	if (!settings) return null;

	const save = (next: DesktopUpdateSettings) => {
		const previous = settings;
		setSettings(next);
		SetUpdateSettings(next.enabled, next.include_prerelease, next.auto_download, next.manifest_url).catch(() => {
			setSettings(previous);
			setSource(previous.manifest_url);
			toast.error(t('desktopSettings.error'));
		});
	};

	const commitSource = () => {
		const value = source.trim() || DEFAULT_MANIFEST_URL;
		setSource(value);
		if (value !== settings.manifest_url) save({ ...settings, manifest_url: value });
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
				title={t('desktopUpdate.autoDownload')}
				description={t('desktopUpdate.autoDownloadHint')}
				checked={settings.auto_download}
				onCheckedChange={(auto_download) => save({ ...settings, auto_download })}
			/>
			<SwitchRow
				title={t('desktopUpdate.prerelease')}
				description={t('desktopUpdate.prereleaseHint')}
				checked={settings.include_prerelease}
				onCheckedChange={(include_prerelease) => save({ ...settings, include_prerelease })}
			/>
			<SettingRow title={t('desktopUpdate.source')} description={t('desktopUpdate.sourceHint')}>
				<Input
					dir="ltr"
					className="w-64"
					value={source}
					onChange={(e) => setSource(e.target.value)}
					onBlur={commitSource}
					onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
					aria-label={t('desktopUpdate.source')}
					autoComplete="off"
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
				/>
			</SettingRow>
			<SettingRow
				title={t('desktopUpdate.version', { version: state?.current_version ?? '' })}
				description={status}
			>
				<div className="flex items-center gap-2">
					{state?.phase === 'available' && state.can_install && (
						<Button size="sm" onClick={() => void DownloadUpdate()}>
							{t('desktopUpdate.banner.download')}
						</Button>
					)}
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
