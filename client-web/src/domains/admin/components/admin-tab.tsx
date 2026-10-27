import { useTranslation } from 'react-i18next';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/store/store';
import { AdminsPanel } from './admins-panel';
import { ConfigPanel } from './config-panel';
import { DataPanel } from './data-panel';
import { OverviewPanel } from './overview-panel';
import { RegistrationPanel } from './registration-panel';

/**
 * The admin panel shown in Settings. Rendering is gated by `server_role`, but
 * that only hides UI: the server re-checks the role from its database on every
 * request, so a tampered client still gets 403.
 */
export function AdminTab() {
	const { t } = useTranslation();
	const role = useAuthStore((s) => s.user?.server_role);
	if (!role) return null;

	return (
		<div className="space-y-6">
			<h2 className="text-xl font-bold text-foreground">{t('admin.title')}</h2>
			<Tabs defaultValue="overview">
				<TabsList className="flex h-auto flex-wrap justify-start">
					<TabsTrigger value="overview">{t('admin.tabs.overview')}</TabsTrigger>
					<TabsTrigger value="registration">{t('admin.tabs.registration')}</TabsTrigger>
					<TabsTrigger value="config">{t('admin.tabs.config')}</TabsTrigger>
					<TabsTrigger value="admins">{t('admin.tabs.admins')}</TabsTrigger>
					{role === 'owner' && <TabsTrigger value="data">{t('admin.tabs.data')}</TabsTrigger>}
				</TabsList>
				<TabsContent value="overview" className="mt-6">
					<OverviewPanel />
				</TabsContent>
				<TabsContent value="registration" className="mt-6">
					<RegistrationPanel />
				</TabsContent>
				<TabsContent value="config" className="mt-6">
					<ConfigPanel />
				</TabsContent>
				<TabsContent value="admins" className="mt-6">
					<AdminsPanel />
				</TabsContent>
				{role === 'owner' && (
					<TabsContent value="data" className="mt-6">
						<DataPanel />
					</TabsContent>
				)}
			</Tabs>
		</div>
	);
}
