import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/store';
import { adminKeys, adminOverview } from '../api/admin.api';
import { useRestartServer, useServerUpdate } from '../api/use-admin';
import { serverRestartStage } from '../utils/server-restart';
import { StepUpDialog, type StepUpValues } from './step-up-dialog';

const POLL_MS = 1500;
/** Gives up waiting after this long; a supervised or slow host may take a while, but not forever. */
const GIVE_UP_MS = 120_000;

/**
 * Owner-only "Restart server" button with the password step-up and a wait-until-back indicator. Admins see
 * nothing. Install types that cannot restart themselves (Docker, unknown) get a disabled button and the reason.
 */
/** @param variant - `card` (overview) adds a titled frame; `inline` (next to a setting) renders just the row. */
export function ServerRestartControl({ variant = 'card' }: { variant?: 'card' | 'inline' }) {
	const { t } = useTranslation();
	const qc = useQueryClient();
	const isOwner = useAuthStore((s) => s.user?.server_role) === 'owner';
	const info = useServerUpdate().data;
	const restart = useRestartServer();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [requested, setRequested] = useState(false);
	const [baseline, setBaseline] = useState(0);
	const stage = serverRestartStage({ requested, sawDown: false, uptimeSeconds: null, baselineUptime: baseline });

	useEffect(() => {
		if (!requested) return;
		let cancelled = false;
		let sawDown = false;
		const started = Date.now();
		const timer = setInterval(() => {
			if (Date.now() - started > GIVE_UP_MS) {
				setRequested(false);
				toast.error(t('admin.restart.timeout'));
				return;
			}
			adminOverview().then(
				(o) => {
					const next = serverRestartStage({
						requested: true,
						sawDown,
						uptimeSeconds: o.uptime_seconds,
						baselineUptime: baseline,
					});
					if (cancelled || next !== 'done') return;
					setRequested(false);
					toast.success(t('admin.restart.done'));
					void qc.invalidateQueries({ queryKey: adminKeys.all });
				},
				() => {
					sawDown = true;
				},
			);
		}, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [requested, baseline, t, qc]);

	if (!isOwner || !info) return null;

	// A wrong password throws, and StepUpDialog shows the message inside the dialog and keeps it open.
	const confirm = async ({ password }: StepUpValues) => {
		const before = await adminOverview();
		await restart.mutateAsync(password);
		setBaseline(before.uptime_seconds);
		setRequested(true);
	};

	const reason =
		info.mode === 'docker' ? t('admin.restart.reason_docker') : t('admin.restart.reason_unsupported');

	const frame = variant === 'card' ? 'space-y-3 rounded-lg border border-border bg-card p-4' : 'space-y-2 pt-3';

	return (
		<section className={frame}>
			{variant === 'card' && <h3 className="text-sm font-semibold text-foreground">{t('admin.restart.title')}</h3>}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-xs text-muted-foreground" role={stage === 'restarting' ? 'status' : undefined}>
					{stage === 'restarting'
						? t('admin.restart.waiting')
						: info.can_restart
							? t('admin.restart.hint')
							: reason}
				</p>
				<Button
					variant="outline"
					onClick={() => setConfirmOpen(true)}
					disabled={!info.can_restart || stage === 'restarting'}
				>
					{stage === 'restarting' ? <Loader2 className="animate-spin" /> : <RotateCw />}
					{t('admin.restart.button')}
				</Button>
			</div>
			<StepUpDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={t('admin.restart.confirm_title')}
				description={t('admin.restart.confirm_body')}
				confirmLabel={t('admin.restart.confirm_action')}
				onSubmit={confirm}
			/>
		</section>
	);
}
