import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ShieldCheck, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/form-field';
import { useAuthStore } from '@/store/store';
import {
	useAdminAccounts,
	useGrantAdmin,
	useRevokeAdmin,
	useTransferOwner,
} from '../api/use-admin';
import { StepUpDialog } from './step-up-dialog';

type Pending =
	| { kind: 'grant'; username: string }
	| { kind: 'revoke'; username: string }
	| { kind: 'transfer'; username: string };

/**
 * Who can open this panel. Everyone sees the list; only the owner can change it,
 * and every change re-checks the owner's password on the server.
 */
export function AdminsPanel() {
	const { t } = useTranslation();
	const me = useAuthStore((s) => s.user);
	const isOwner = me?.server_role === 'owner';
	const accounts = useAdminAccounts();
	const grant = useGrantAdmin();
	const revoke = useRevokeAdmin();
	const transfer = useTransferOwner();
	const [username, setUsername] = useState('');
	const [pending, setPending] = useState<Pending | null>(null);

	const submit = async (password: string) => {
		if (!pending) return;
		const { kind, username: name } = pending;
		if (kind === 'grant') await grant.mutateAsync({ username: name, password });
		else if (kind === 'revoke') await revoke.mutateAsync({ username: name, password });
		else await transfer.mutateAsync({ username: name, password, confirm: 'TRANSFER' });
		toast.success(t(`admin.admins.done_${kind}`, { username: name }));
		if (kind === 'grant') setUsername('');
	};

	return (
		<div className="space-y-6">
			<p className="text-sm text-muted-foreground">{t('admin.admins.description')}</p>

			<ul className="divide-y divide-border rounded-lg border border-border bg-card">
				{accounts.data?.admins.map((a) => (
					<li key={a.id} className="flex items-center gap-3 px-4 py-3">
						<ShieldCheck size={16} className="text-muted-foreground" />
						<span className="font-medium text-foreground">{a.username}</span>
						<Badge variant={a.role === 'owner' ? 'default' : 'secondary'}>
							{t(`admin.roles.${a.role}`)}
						</Badge>
						<div className="ms-auto flex gap-1">
							{isOwner && a.role === 'admin' && (
								<>
									<Button
										size="sm"
										variant="outline"
										onClick={() => setPending({ kind: 'transfer', username: a.username })}
									>
										{t('admin.admins.make_owner')}
									</Button>
									<Button
										size="icon"
										variant="ghost"
										aria-label={t('admin.admins.remove')}
										onClick={() => setPending({ kind: 'revoke', username: a.username })}
									>
										<Trash2 className="text-destructive" />
									</Button>
								</>
							)}
						</div>
					</li>
				))}
			</ul>

			{isOwner && (
				<form
					className="flex items-end gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (username.trim()) setPending({ kind: 'grant', username: username.trim() });
					}}
				>
					<FormField label={t('admin.admins.add')} className="flex-1">
						{(c) => (
							<Input
								{...c}
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder={t('admin.admins.username_placeholder')}
								autoComplete="off"
								autoCorrect="off"
								autoCapitalize="off"
								spellCheck={false}
							/>
						)}
					</FormField>
					<Button type="submit" disabled={!username.trim()}>
						{t('admin.admins.grant')}
					</Button>
				</form>
			)}

			<StepUpDialog
				open={pending !== null}
				onOpenChange={(o) => !o && setPending(null)}
				title={pending ? t(`admin.admins.confirm_${pending.kind}_title`, { username: pending.username }) : ''}
				description={pending ? t(`admin.admins.confirm_${pending.kind}_description`, { username: pending.username }) : ''}
				confirmLabel={t('common.confirm')}
				destructive={pending?.kind !== 'grant'}
				phrase={pending?.kind === 'transfer' ? 'TRANSFER' : undefined}
				onSubmit={({ password }) => submit(password)}
			/>
		</div>
	);
}
