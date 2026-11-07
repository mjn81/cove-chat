import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { SwitchRow } from '@/components/setting-row';
import { DesktopSection } from '@/domains/desktop/components/desktop-section';
import { useAppStore } from '@/store/store';
import { requestNotificationPermission } from '@/utils/notifications';
import { isWails } from '@/utils/wails';
import { CustomNotificationsAvailable, GetCustomNotifications, SetCustomNotifications } from '@/wailsjs/go/main/App';

/** Settings page for desktop notification and notification-sound preferences. */
export const NotificationsTab = () => {
	const { t } = useTranslation();
	const {
		enableDesktopNotifications,
		enableNotificationSounds,
		setEnableDesktopNotifications,
		setEnableNotificationSounds,
	} = useAppStore();

	// Desktop app only (Windows and Linux): Cove's own popups instead of the system's notifications.
	const [popupsAvailable, setPopupsAvailable] = useState(false);
	const [customPopups, setCustomPopups] = useState(true);
	useEffect(() => {
		if (!isWails()) return;
		void CustomNotificationsAvailable()
			.then((ok) => {
				setPopupsAvailable(ok);
				if (ok) void GetCustomNotifications().then(setCustomPopups);
			})
			.catch(() => {});
	}, []);

	const handleToggleCustomPopups = (next: boolean) => {
		setCustomPopups(next);
		void SetCustomNotifications(next).catch(() => {
			setCustomPopups(!next);
			toast.error(t('desktopSettings.error'));
		});
	};

	const handleToggleDesktop = async (enabled: boolean) => {
		if (enabled) {
			const permission = await requestNotificationPermission();
			if (permission !== 'granted') {
				toast.error(t('errors.notification_denied'));
				return;
			}
		}
		setEnableDesktopNotifications(enabled);
	};

	return (
		<div className="mx-auto w-full max-w-[500px] animate-in fade-in slide-in-from-right-4 duration-300">
			<h2 className="mb-5 text-xl font-bold text-foreground">{t('settings.notifications')}</h2>
			<div className="space-y-6">
				<div className="divide-y divide-border rounded-lg border border-border bg-muted px-4">
					<SwitchRow
						title={t('settings.notifications_desktop')}
						description={t('settings.notifications_desktop_desc')}
						checked={enableDesktopNotifications}
						onCheckedChange={handleToggleDesktop}
					/>
					{popupsAvailable && (
						<SwitchRow
							title={t('settings.notifications_custom')}
							description={t('settings.notifications_custom_desc')}
							checked={customPopups}
							onCheckedChange={handleToggleCustomPopups}
						/>
					)}
					<SwitchRow
						title={t('settings.notifications_sounds')}
						description={t('settings.notifications_sounds_desc')}
						checked={enableNotificationSounds}
						onCheckedChange={setEnableNotificationSounds}
					/>
				</div>
			</div>
			<DesktopSection />
		</div>
	);
};
