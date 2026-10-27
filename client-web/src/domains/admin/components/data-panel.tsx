import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/setting-row';
import { useAuthStore } from '@/store/store';
import { useAdminOverview } from '../api/use-admin';
import { adminBackup, adminDeleteServer, adminReset } from '../api/admin.api';
import { StepUpDialog } from './step-up-dialog';

type Action = 'backup' | 'reset' | 'delete';

/** Saves a blob through a temporary link; the object URL is revoked right after. */
function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/** Owner-only: encrypted backup, reset, and deleting the whole server. */
export function DataPanel() {
	const { t } = useTranslation();
	const logout = useAuthStore((s) => s.logout);
	const domain = useAdminOverview().data?.domain ?? '';
	const [action, setAction] = useState<Action | null>(null);

	const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

	return (
		<div className="space-y-8">
			<section>
				<h3 className="text-sm font-semibold text-foreground">{t('admin.data.backup_title')}</h3>
				<SettingRow title={t('admin.data.backup')} description={t('admin.data.backup_hint')}>
					<Button variant="outline" onClick={() => setAction('backup')}>
						<Download />
						{t('admin.data.backup_button')}
					</Button>
				</SettingRow>
			</section>

			<section className="rounded-lg border border-destructive/40 p-4">
				<h3 className="text-sm font-semibold text-destructive">{t('admin.data.danger_title')}</h3>
				<div className="divide-y divide-border">
					<SettingRow title={t('admin.data.reset')} description={t('admin.data.reset_hint')}>
						<Button variant="destructive" onClick={() => setAction('reset')}>
							{t('admin.data.reset_button')}
						</Button>
					</SettingRow>
					<SettingRow title={t('admin.data.delete')} description={t('admin.data.delete_hint')}>
						<Button variant="destructive" onClick={() => setAction('delete')}>
							{t('admin.data.delete_button')}
						</Button>
					</SettingRow>
				</div>
			</section>

			<StepUpDialog
				open={action === 'backup'}
				onOpenChange={(o) => !o && setAction(null)}
				title={t('admin.data.backup_title')}
				description={t('admin.data.backup_confirm')}
				confirmLabel={t('admin.data.backup_button')}
				needsPassphrase
				onSubmit={async ({ password, passphrase }) => {
					const blob = await adminBackup(password, passphrase);
					downloadBlob(blob, `cove-${stamp()}.cove-backup`);
					toast.success(t('admin.data.backup_done'));
				}}
			/>
			<StepUpDialog
				open={action === 'reset'}
				onOpenChange={(o) => !o && setAction(null)}
				title={t('admin.data.reset')}
				description={t('admin.data.reset_confirm')}
				confirmLabel={t('admin.data.reset_button')}
				destructive
				phrase="RESET"
				onSubmit={async ({ password }) => {
					await adminReset(password, 'RESET');
					toast.success(t('admin.data.reset_done'));
				}}
			/>
			<StepUpDialog
				open={action === 'delete'}
				onOpenChange={(o) => !o && setAction(null)}
				title={t('admin.data.delete')}
				description={t('admin.data.delete_confirm')}
				confirmLabel={t('admin.data.delete_button')}
				destructive
				phrase={domain || undefined}
				onSubmit={async ({ password }) => {
					await adminDeleteServer(password, domain);
					await logout();
				}}
			/>
		</div>
	);
}
