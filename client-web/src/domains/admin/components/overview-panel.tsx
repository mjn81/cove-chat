import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { useAdminAudit, useAdminOverview } from '../api/use-admin';
import { formatBytes, formatUptime } from '../utils/admin-format';
import { ServerUpdatePanel } from './server-update-panel';
import { ServerRestartControl } from './server-restart-control';

function Stat({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 truncate text-xl font-semibold text-foreground">{value}</p>
		</div>
	);
}

/** Server numbers plus the audit trail of recent admin actions. */
export function OverviewPanel() {
	const { t } = useTranslation();
	const overview = useAdminOverview();
	const audit = useAdminAudit();

	if (overview.isLoading) return <Loader2 className="animate-spin text-muted-foreground" />;
	const o = overview.data;
	if (!o) return null;

	return (
		<div className="space-y-8">
			<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
				<Stat label={t('admin.overview.users')} value={o.users} />
				<Stat label={t('admin.overview.channels')} value={o.channels} />
				<Stat label={t('admin.overview.active_invites')} value={o.active_invites} />
				<Stat label={t('admin.overview.uptime')} value={formatUptime(o.uptime_seconds)} />
				<Stat label={t('admin.overview.data_size')} value={formatBytes(o.data_size_bytes)} />
				<Stat label={t('admin.overview.version')} value={o.version} />
			</div>

			<ServerUpdatePanel />
			<ServerRestartControl />

			<section>
				<h3 className="mb-2 text-sm font-semibold text-foreground">
					{t('admin.audit.title')}
				</h3>
				{audit.data?.length ? (
					<>
					<ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
						{audit.data.map((e) => (
							<li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
								<span className="font-medium text-foreground">{e.actor_name}</span>
								<span className="text-muted-foreground">
									{t(`admin.audit.actions.${e.action}`, { defaultValue: e.action })}
								</span>
								{e.target && <span className="truncate text-foreground">{e.target}</span>}
								<time
									dateTime={e.at}
									className="ms-auto text-xs text-muted-foreground"
								>
									{new Date(e.at).toLocaleString()}
								</time>
							</li>
						))}
					</ul>
					{audit.hasNextPage && (
						<Button
							variant="ghost"
							size="sm"
							className="mt-2"
							disabled={audit.isFetchingNextPage}
							onClick={() => void audit.fetchNextPage()}
						>
							{audit.isFetchingNextPage && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
							{t('common.load_more')}
						</Button>
					)}
					</>
				) : (
					<p className="text-sm text-muted-foreground">{t('admin.audit.empty')}</p>
				)}
			</section>
		</div>
	);
}
