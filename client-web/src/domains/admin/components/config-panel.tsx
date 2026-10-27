import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { SettingRow } from '@/components/setting-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/store/store';
import { useAdminConfig, useUpdateAdminConfig } from '../api/use-admin';
import { adminErrorMessage } from '../utils/admin-errors';
import type { ConfigSetting, ConfigValue } from '../types/admin.types';
import { StepUpDialog } from './step-up-dialog';

type Draft = Record<string, ConfigValue>;

function SettingControl({
	setting,
	value,
	disabled,
	onChange,
}: {
	setting: ConfigSetting;
	value: ConfigValue;
	disabled: boolean;
	onChange: (v: ConfigValue) => void;
}) {
	const { t } = useTranslation();
	const label = t(`admin.config.keys.${setting.key}`, { defaultValue: setting.key });
	switch (setting.type) {
		case 'bool':
			return <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} aria-label={label} />;
		case 'enum':
			return (
				<Select value={String(value)} onValueChange={onChange} disabled={disabled}>
					<SelectTrigger className="w-44" aria-label={label}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{setting.options?.map((o) => (
							<SelectItem key={o} value={o}>
								{o}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case 'int':
			return (
				<Input
					className="w-32"
					type="number"
					min={setting.min}
					max={setting.max}
					value={String(value)}
					disabled={disabled}
					aria-label={label}
					onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
				/>
			);
		default:
			return (
				<Input
					className="w-56"
					value={String(value)}
					disabled={disabled}
					aria-label={label}
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
					spellCheck={false}
					onChange={(e) => onChange(e.target.value)}
				/>
			);
	}
}

/**
 * Schema-driven editor for config.toml. The server decides which keys exist
 * and which need the owner; this panel never invents a setting.
 */
export function ConfigPanel() {
	const { t } = useTranslation();
	const role = useAuthStore((s) => s.user?.server_role);
	const config = useAdminConfig();
	const save = useUpdateAdminConfig();
	const [draft, setDraft] = useState<Draft>({});
	const [askPassword, setAskPassword] = useState(false);

	// Registration lives in its own tab.
	const settings = (config.data?.settings ?? []).filter((s) => s.key !== 'registration.mode');
	const dirty = settings.filter((s) => s.key in draft && draft[s.key] !== s.value);
	const needsOwner = dirty.some((s) => s.owner_only);
	const invalid = dirty.some((s) => draft[s.key] === '');

	const changes = (): Draft => Object.fromEntries(dirty.map((s) => [s.key, draft[s.key]]));

	const onSaved = (restart: string[]) => {
		setDraft({});
		toast.success(t('admin.config.saved'));
		if (restart.length > 0) toast.info(t('admin.config.restart_needed'));
	};

	const run = (password?: string) =>
		save.mutateAsync({ changes: changes(), password }).then((r) => onSaved(r.restart_required));

	if (config.isLoading) return <Loader2 className="animate-spin text-muted-foreground" />;

	const groups = [...new Set(settings.map((s) => s.group))];

	return (
		<div className="space-y-8">
			{groups.map((group) => (
				<section key={group}>
					<h3 className="mb-1 text-sm font-semibold text-foreground">
						{t(`admin.config.groups.${group}`, { defaultValue: group })}
					</h3>
					<div className="divide-y divide-border">
						{settings
							.filter((s) => s.group === group)
							.map((s) => (
								<SettingRow
									key={s.key}
									title={t(`admin.config.keys.${s.key}`, { defaultValue: s.key })}
									description={[
										s.owner_only ? t('admin.config.owner_only') : '',
										s.restart_required ? t('admin.config.needs_restart') : '',
									]
										.filter(Boolean)
										.join(' · ')}
								>
									<SettingControl
										setting={s}
										value={s.key in draft ? draft[s.key] : s.value}
										disabled={s.owner_only && role !== 'owner'}
										onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))}
									/>
								</SettingRow>
							))}
					</div>
				</section>
			))}

			<div className="flex gap-2">
				<Button
					disabled={dirty.length === 0 || invalid || save.isPending}
					onClick={() => (needsOwner ? setAskPassword(true) : run().catch((err) => toast.error(adminErrorMessage(t, err))))}
				>
					{t('common.save')}
				</Button>
				<Button variant="ghost" disabled={dirty.length === 0} onClick={() => setDraft({})}>
					{t('admin.config.discard')}
				</Button>
			</div>

			<StepUpDialog
				open={askPassword}
				onOpenChange={setAskPassword}
				title={t('admin.config.confirm_title')}
				description={t('admin.config.confirm_description')}
				confirmLabel={t('common.save')}
				onSubmit={({ password }) => run(password)}
			/>
		</div>
	);
}
