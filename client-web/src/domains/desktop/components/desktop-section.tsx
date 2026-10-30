import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { SwitchRow } from '@/components/setting-row';
import { isWails } from '@/utils/wails';
import { GetAutostart, GetCloseToTray, SetAutostart, SetCloseToTray } from '../../../wailsjs/go/main/App';

/**
 * Settings section for the desktop app's background behaviour: keep running in the tray when the window is
 * closed, and start with the computer (minimised to the tray). Renders nothing in a browser.
 */
export function DesktopSection() {
	const { t } = useTranslation();
	const [closeToTray, setCloseToTray] = useState(true);
	const [autostart, setAutostart] = useState(false);
	const desktop = isWails();

	useEffect(() => {
		if (!desktop) return;
		void GetCloseToTray().then(setCloseToTray).catch(() => {});
		void GetAutostart().then(setAutostart).catch(() => {});
	}, [desktop]);

	if (!desktop) return null;

	const toggleCloseToTray = (next: boolean) => {
		setCloseToTray(next);
		void SetCloseToTray(next).catch(() => {
			setCloseToTray(!next);
			toast.error(t('desktopSettings.error'));
		});
	};

	const toggleAutostart = (next: boolean) => {
		setAutostart(next);
		SetAutostart(next).catch((err: unknown) => {
			setAutostart(!next);
			toast.error(err instanceof Error ? err.message : t('desktopSettings.error'));
		});
	};

	return (
		<section className="mt-8" aria-labelledby="desktop-settings-title">
			<h3 id="desktop-settings-title" className="mb-1 text-lg font-bold text-foreground">
				{t('desktopSettings.title')}
			</h3>
			<SwitchRow
				title={t('desktopSettings.closeToTray')}
				description={t('desktopSettings.closeToTrayHint')}
				checked={closeToTray}
				onCheckedChange={toggleCloseToTray}
			/>
			<SwitchRow
				title={t('desktopSettings.autostart')}
				description={t('desktopSettings.autostartHint')}
				checked={autostart}
				onCheckedChange={toggleAutostart}
			/>
		</section>
	);
}
