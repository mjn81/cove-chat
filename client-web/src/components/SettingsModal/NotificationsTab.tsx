import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { SwitchRow } from '@/components/setting-row';
import { DesktopSection } from '@/domains/desktop/components/desktop-section';
import { useAppStore } from '@/store/store';
import { requestNotificationPermission } from '@/utils/notifications';

/** Settings page for desktop notification and notification-sound preferences. */
export const NotificationsTab = () => {
	const { t } = useTranslation();
	const {
		enableDesktopNotifications,
		enableNotificationSounds,
		setEnableDesktopNotifications,
		setEnableNotificationSounds,
	} = useAppStore();

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
