import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/setting-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
	useAdminConfig,
	useAdminInvites,
	useRevokeInvite,
	useUpdateAdminConfig,
} from '../api/use-admin';
import { adminErrorMessage } from '../utils/admin-errors';
import { formatInviteUses, liveInviteStatus, maskInviteCode } from '../utils/admin-format';
import type { RegistrationMode } from '../types/admin.types';
import { InviteForm } from './invite-form';

const MODES: RegistrationMode[] = ['open', 'invite_only', 'closed'];

/** Registration mode switch plus invitation code management. */
export function RegistrationPanel() {
	const { t } = useTranslation();
	const config = useAdminConfig();
	const save = useUpdateAdminConfig();
	const invites = useAdminInvites();
	const revoke = useRevokeInvite();
	// Codes stay masked until someone clicks the eye, so the page is safe to show on a stream.
	const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
	const toggleReveal = (code: string) =>
		setRevealed((prev) => {
			const next = new Set(prev);
			if (!next.delete(code)) next.add(code);
			return next;
		});

	const mode = config.data?.settings.find((s) => s.key === 'registration.mode')?.value as
		| RegistrationMode
		| undefined;

	const changeMode = (next: string) =>
		save.mutate(
			{ changes: { 'registration.mode': next } },
			{
				onSuccess: () => toast.success(t('admin.registration.saved')),
				onError: (err) => toast.error(adminErrorMessage(t, err)),
			},
		);

	const copy = (code: string) => {
		void navigator.clipboard?.writeText(code).then(() => toast.success(t('admin.invites.copied')));
	};

	return (
		<div className="space-y-8">
			<section>
				<SettingRow
					title={t('admin.registration.mode')}
					description={t(`admin.registration.mode_${mode ?? 'open'}_hint`)}
				>
					{mode ? (
						<Select value={mode} onValueChange={changeMode} disabled={save.isPending}>
							<SelectTrigger className="w-44" aria-label={t('admin.registration.mode')}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{MODES.map((m) => (
									<SelectItem key={m} value={m}>
										{t(`admin.registration.mode_${m}`)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<Loader2 className="animate-spin text-muted-foreground" />
					)}
				</SettingRow>
			</section>

			<section className="space-y-3">
				<h3 className="text-sm font-semibold text-foreground">{t('admin.invites.title')}</h3>
				<InviteForm />

				{invites.data?.invites.length ? (
					<ul className="divide-y divide-border rounded-lg border border-border bg-card">
						{invites.data.invites.map((inv) => {
							const status = liveInviteStatus(inv);
							return (
								<li key={inv.code} className="flex flex-wrap items-center gap-3 px-4 py-3">
									<code className="font-mono text-sm text-foreground">
										{revealed.has(inv.code) ? inv.code : maskInviteCode(inv.code)}
									</code>
									<Badge variant={status === 'active' ? 'default' : 'secondary'}>
										{t(`admin.invites.status_${status}`)}
									</Badge>
									<span className="text-xs text-muted-foreground">
										{t('admin.invites.uses', { uses: formatInviteUses(inv) })}
									</span>
									{inv.expires_at && (
										<span className="text-xs text-muted-foreground">
											{t('admin.invites.expires_on', {
												date: new Date(inv.expires_at).toLocaleString(),
											})}
										</span>
									)}
									{inv.source === 'config' && (
										<Badge variant="outline">{t('admin.invites.from_config')}</Badge>
									)}
									{inv.note && <span className="truncate text-xs text-muted-foreground">{inv.note}</span>}
									<div className="ms-auto flex gap-1">
										<Button
											size="icon"
											variant="ghost"
											aria-label={t(revealed.has(inv.code) ? 'admin.invites.hide' : 'admin.invites.show')}
											aria-pressed={revealed.has(inv.code)}
											onClick={() => toggleReveal(inv.code)}
										>
											{revealed.has(inv.code) ? <EyeOff /> : <Eye />}
										</Button>
										<Button size="icon" variant="ghost" aria-label={t('admin.invites.copy')} onClick={() => copy(inv.code)}>
											<Copy />
										</Button>
										{inv.source === 'panel' && status !== 'revoked' && (
											<Button
												size="icon"
												variant="ghost"
												aria-label={t('admin.invites.revoke')}
												disabled={revoke.isPending}
												onClick={() =>
													revoke.mutate(inv.code, {
														onError: (err) => toast.error(adminErrorMessage(t, err)),
													})
												}
											>
												<Trash2 className="text-destructive" />
											</Button>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">{t('admin.invites.empty')}</p>
				)}
			</section>
		</div>
	);
}
