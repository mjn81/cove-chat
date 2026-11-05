import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SettingRow } from '@/components/setting-row';
import { useAuthStore } from '@/store/store';
import { adminKeys } from '../api/admin.api';
import { useCheckServerUpdate, useServerUpdate, useStartServerUpdate } from '../api/use-admin';
import { adminErrorMessage } from '../utils/admin-errors';
import { ServerUpdateUpload } from './server-update-upload';
import { StepUpDialog, type StepUpValues } from './step-up-dialog';
import { isUpdateBusy, previewReleaseNotes, serverUpdateStage } from '../utils/server-update';

/** Docker installs are replaced by pulling a new image, never in place; shows the exact commands. */
function DockerInstructions({ command }: { command: string }) {
	const { t } = useTranslation();
	return (
		<div className="space-y-2 rounded-lg border border-border bg-muted p-3 text-sm">
			<p className="font-medium text-foreground">{t('admin.update.docker_title')}</p>
			<p className="text-muted-foreground">{t('admin.update.docker_body')}</p>
			<code dir="ltr" className="block overflow-x-auto rounded-md bg-background p-2 text-xs text-foreground">
				{command}
			</code>
			<p className="text-xs text-muted-foreground">{t('admin.update.docker_watchtower')}</p>
		</div>
	);
}

/**
 * Overview card for the server self-update: current vs latest version, release notes, and (owner only) the
 * "Update server" button. While an update runs it follows the job, then waits for the restarted server to
 * come back on the new version.
 */
export function ServerUpdatePanel() {
	const { t } = useTranslation();
	const qc = useQueryClient();
	const isOwner = useAuthStore((s) => s.user?.server_role) === 'owner';
	const [target, setTarget] = useState<string | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmSource, setConfirmSource] = useState<'release' | 'upload'>('release');

	const query = useServerUpdate(target);
	const check = useCheckServerUpdate();
	const start = useStartServerUpdate();
	const info = query.data;
	const stage = serverUpdateStage({ info, target, pollFailed: query.isError });
	const busy = isUpdateBusy(stage);

	useEffect(() => {
		if (stage === 'done') {
			toast.success(t('admin.update.done', { version: target }));
			void qc.invalidateQueries({ queryKey: adminKeys.all });
		}
	}, [stage, target, t, qc]);

	if (!info) {
		return query.isLoading ? <Loader2 className="animate-spin text-muted-foreground" /> : null;
	}

	// A wrong password throws, and StepUpDialog shows the message inside the dialog and keeps it open.
	const confirm = async ({ password }: StepUpValues) => {
		const started = await start.mutateAsync({ source: confirmSource, password });
		setTarget(started.version);
	};

	const stageText: Record<string, string> = {
		downloading: t('admin.update.stage_downloading'),
		installing: t('admin.update.stage_installing'),
		restarting: t('admin.update.stage_restarting'),
		reconnecting: t('admin.update.stage_reconnecting'),
	};
	const disabledReason =
		info.reason === 'docker'
			? t('admin.update.reason_docker')
			: info.reason === 'unsupported'
				? t('admin.update.reason_unsupported')
				: info.reason === 'up_to_date'
					? t('admin.update.up_to_date')
					: null;

	return (
		<section className="space-y-3 rounded-lg border border-border bg-card p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold text-foreground">{t('admin.update.title')}</h3>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => check.mutate()}
					disabled={check.isPending || busy}
				>
					<RefreshCw className={check.isPending ? 'animate-spin' : undefined} />
					{t('admin.update.check_now')}
				</Button>
			</div>

			<div className="divide-y divide-border">
				<SettingRow title={t('admin.update.current')}>
					<span dir="ltr" className="text-sm text-foreground">{info.current_version}</span>
				</SettingRow>
				<SettingRow
					title={t('admin.update.latest')}
					description={info.check_error ? adminErrorMessage(t, new Error(info.check_error)) : undefined}
				>
					<span className="flex items-center gap-2 text-sm text-foreground">
						<span dir="ltr">{info.latest_version || '—'}</span>
						{info.prerelease && <Badge variant="secondary">{t('admin.update.prerelease')}</Badge>}
					</span>
				</SettingRow>
			</div>

			{info.source && (
				<p className="text-xs text-muted-foreground">
					{t('admin.update.source_label')}{' '}
					{info.source === 'manifest' ? t('admin.update.source_manifest') : t('admin.update.source_github')}
				</p>
			)}

			{info.mode === 'docker' && <DockerInstructions command={info.instructions ?? ''} />}

			{isOwner && info.mode !== 'docker' && !busy && (
				<ServerUpdateUpload
					uploaded={info.uploaded}
					disabled={info.mode !== 'binary'}
					onInstall={() => {
						setConfirmSource('upload');
						setConfirmOpen(true);
					}}
				/>
			)}

			{info.update_available && info.release_notes && (
				<details className="rounded-lg border border-border p-3 text-sm">
					<summary className="cursor-pointer font-medium text-foreground">
						{t('admin.update.notes', { version: info.latest_version })}
					</summary>
					<p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
						{previewReleaseNotes(info.release_notes, 4000)}
					</p>
					{info.release_url && (
						<a
							href={info.release_url}
							target="_blank"
							rel="noreferrer"
							className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
						>
							{t('admin.update.view_release')}
							<ExternalLink className="size-3 rtl:-scale-x-100" />
						</a>
					)}
				</details>
			)}

			{busy && (
				<div className="space-y-2" role="status" aria-live="polite">
					<p className="flex items-center gap-2 text-sm text-foreground">
						<Loader2 className="size-4 animate-spin" />
						{stageText[stage]}
					</p>
					{stage === 'downloading' && <Progress value={info.progress_percent} />}
				</div>
			)}

			{stage === 'failed' && (
				<p className="text-sm text-destructive" role="alert">
					{t('admin.update.failed', { reason: adminErrorMessage(t, new Error(info.error ?? '')) })}
				</p>
			)}

			{isOwner && !busy && (
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p className="text-xs text-muted-foreground">{disabledReason}</p>
					<Button
						onClick={() => {
						setConfirmSource('release');
						setConfirmOpen(true);
					}}
						disabled={!info.can_update || start.isPending}
					>
						<Download />
						{t('admin.update.button')}
					</Button>
				</div>
			)}
			{!isOwner && info.update_available && (
				<p className="text-xs text-muted-foreground">{t('admin.update.owner_only')}</p>
			)}

			<StepUpDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={t('admin.update.confirm_title', {
					version: confirmSource === 'upload' ? (info.uploaded?.version ?? '') : info.latest_version,
				})}
				description={`${t('admin.update.confirm_body')} ${t('admin.update.confirm_detail')}`}
				confirmLabel={t('admin.update.confirm_action')}
				onSubmit={confirm}
			/>
		</section>
	);
}
