import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/form-field';
import { useCreateInvite } from '../api/use-admin';
import { adminErrorMessage } from '../utils/admin-errors';
import { toRFC3339 } from '../utils/admin-format';

type UseType = 'limited' | 'unlimited';

/** Creates an invitation code: limited (N uses) or unlimited, with an optional expiry. */
export function InviteForm() {
	const { t } = useTranslation();
	const create = useCreateInvite();
	const [useType, setUseType] = useState<UseType>('limited');
	const [maxUses, setMaxUses] = useState('1');
	const [expires, setExpires] = useState('');
	const [code, setCode] = useState('');
	const [note, setNote] = useState('');

	const uses = Number(maxUses);
	const valid = useType === 'unlimited' || (Number.isInteger(uses) && uses >= 1 && uses <= 1_000_000);

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		create.mutate(
			{
				code: code.trim() || undefined,
				note: note.trim() || undefined,
				max_uses: useType === 'unlimited' ? 0 : uses,
				expires_at: toRFC3339(expires),
			},
			{
				onSuccess: (inv) => {
					toast.success(t('admin.invites.created', { code: inv.code }));
					setCode('');
					setNote('');
				},
				onError: (err) => toast.error(adminErrorMessage(t, err)),
			},
		);
	};

	return (
		<form onSubmit={submit} className="grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-2">
			<div className="space-y-1.5">
				<span className="text-sm font-medium">{t('admin.invites.type')}</span>
				<div className="flex gap-2">
					{(['limited', 'unlimited'] as const).map((type) => (
						<Button
							key={type}
							type="button"
							size="sm"
							variant={useType === type ? 'default' : 'outline'}
							aria-pressed={useType === type}
							onClick={() => setUseType(type)}
						>
							{t(`admin.invites.type_${type}`)}
						</Button>
					))}
				</div>
			</div>

			{useType === 'limited' && (
				<FormField label={t('admin.invites.max_uses')} required>
					{(c) => (
						<Input
							{...c}
							type="number"
							min={1}
							max={1000000}
							value={maxUses}
							onChange={(e) => setMaxUses(e.target.value)}
						/>
					)}
				</FormField>
			)}

			<FormField label={t('admin.invites.expires')} hint={t('admin.invites.expires_hint')}>
				{(c) => (
					<Input {...c} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
				)}
			</FormField>

			<FormField label={t('admin.invites.code')} hint={t('admin.invites.code_hint')}>
				{(c) => (
					<Input
						{...c}
						value={code}
						onChange={(e) => setCode(e.target.value)}
						maxLength={64}
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="off"
						spellCheck={false}
					/>
				)}
			</FormField>

			<FormField label={t('admin.invites.note')} className="md:col-span-2">
				{(c) => (
					<Input {...c} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoComplete="off" />
				)}
			</FormField>

			<div className="md:col-span-2">
				<Button type="submit" disabled={!valid || create.isPending}>
					{t('admin.invites.create')}
				</Button>
			</div>
		</form>
	);
}
