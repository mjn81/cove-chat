import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Globe, Laptop, Loader2, LogOut, MonitorSmartphone, Smartphone, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ConfirmModal';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { ListRow } from '@/components/list-row';
import { APIError } from '@/api/client';
import { useGetSessions, useTerminateOtherSessions, useTerminateSession } from '../api/use-sessions';
import type { SessionInfo } from '../types/sessions.types';
import { formatSessionSubtitleParts, relativeTimeParts } from '../utils/sessions-format';

/** Picks the icon that best matches where the session is running. */
function DeviceIcon({ session }: { session: SessionInfo }) {
	const common = { size: 20, className: 'text-muted-foreground' };
	if (session.platform === 'Android' || session.platform === 'iOS') return <Smartphone {...common} />;
	if (session.app_name.toLowerCase().includes('desktop')) return <Laptop {...common} />;
	if (session.platform) return <Globe {...common} />;
	return <MonitorSmartphone {...common} />;
}

/**
 * "Devices" section of Settings > Privacy, Telegram-style: this device on top, every other signed-in device
 * below with where and when it was last active, and buttons to terminate one or all of the others.
 */
export function DevicesSection() {
	const { t } = useTranslation();
	const { data: sessions, isLoading, isError } = useGetSessions();
	const terminate = useTerminateSession();
	const terminateOthers = useTerminateOtherSessions();
	const [confirmAll, setConfirmAll] = useState(false);
	const [pending, setPending] = useState<SessionInfo | null>(null);

	const current = sessions?.find((s) => s.current);
	const others = sessions?.filter((s) => !s.current) ?? [];

	const onError = (err: unknown) => toast.error(err instanceof APIError ? err.message : t('devices.error'));

	const lastActive = (s: SessionInfo) => {
		const { unit, value } = relativeTimeParts(s.last_active_at);
		return unit === 'now' ? t('devices.activeNow') : t(`devices.ago.${unit}`, { n: value });
	};

	const subtitle = (s: SessionInfo) => formatSessionSubtitleParts(s).join(' · ');

	return (
		<section className="flex flex-col gap-4" aria-labelledby="devices-title">
			<div>
				<h3 id="devices-title" className="text-lg font-bold text-foreground">
					{t('devices.title')}
				</h3>
				<p className="text-xs text-muted-foreground">{t('devices.subtitle')}</p>
			</div>

			{isLoading && (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 size={16} className="animate-spin" />
					{t('devices.loading')}
				</div>
			)}
			{isError && <p className="text-sm text-destructive">{t('devices.error')}</p>}

			{current && (
				<div className="rounded-2xl border border-border/70 bg-card/60 p-3">
					<p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{t('devices.thisDevice')}
					</p>
					<ListRow
						leading={<DeviceIcon session={current} />}
						title={current.device_name || t('devices.unknown')}
						subtitle={subtitle(current)}
					/>
					{others.length > 0 && (
						<Button
							variant="ghost"
							className="mt-2 w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
							disabled={terminateOthers.isPending}
							onClick={() => setConfirmAll(true)}
						>
							<LogOut size={16} />
							{t('devices.terminateOthers')}
						</Button>
					)}
				</div>
			)}

			{sessions && others.length === 0 && (
				<EmptyState
					icon={<MonitorSmartphone />}
					title={t('devices.noOthers')}
					description={t('devices.noOthersHint')}
				/>
			)}

			{others.length > 0 && (
				<div className="rounded-2xl border border-border/70 bg-card/60 p-3">
					<p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{t('devices.activeSessions')}
					</p>
					<ul className="flex flex-col">
						{others.map((s) => (
							<li key={s.id}>
								<ListRow
									leading={<DeviceIcon session={s} />}
									title={s.device_name || t('devices.unknown')}
									subtitle={`${subtitle(s)} · ${lastActive(s)}`}
									trailing={
										<IconButton
											label={t('devices.terminate')}
											tone="destructive"
											onClick={() => setPending(s)}
											disabled={terminate.isPending}
										>
											<X size={16} />
										</IconButton>
									}
								/>
							</li>
						))}
					</ul>
				</div>
			)}

			<ConfirmModal
				isOpen={confirmAll}
				onClose={() => setConfirmAll(false)}
				onConfirm={() => terminateOthers.mutate(undefined, { onSuccess: () => toast.success(t('devices.terminatedAll')), onError })}
				title={t('devices.terminateOthers')}
				message={t('devices.terminateOthersConfirm')}
				confirmText={t('devices.terminateOthersAction')}
				variant="danger"
			/>
			<ConfirmModal
				isOpen={pending !== null}
				onClose={() => setPending(null)}
				onConfirm={() => {
					if (pending) terminate.mutate(pending.id, { onSuccess: () => toast.success(t('devices.terminated')), onError });
				}}
				title={t('devices.terminate')}
				message={t('devices.terminateConfirm', { device: pending?.device_name || t('devices.unknown') })}
				confirmText={t('devices.terminate')}
				variant="danger"
			/>
		</section>
	);
}
