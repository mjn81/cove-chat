import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { SettingRow } from '@/components/setting-row';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuthStore } from '@/store/store';
import { useAdminConfig, useUpdateAdminConfig } from '../api/use-admin';
import type { ConfigSetting, ConfigValue } from '../types/admin.types';
import { adminErrorMessage } from '../utils/admin-errors';
import { checkStyleSelection, toggleStyle } from '../utils/admin-packs';
import { StepUpDialog } from './step-up-dialog';

const LIMIT_KEYS = ['packs.max_packs_per_user', 'packs.max_stickers_per_pack', 'packs.max_user_storage_mb'] as const;

/**
 * Which emoji styles users may choose and the server default, the "allow user sticker uploads" switch and the
 * per-user quotas. These are ordinary server settings (`emoji.*`, `packs.*`) applied live; the server validates
 * them again and is the authority.
 */
export function EmojiSettingsSection() {
	const { t } = useTranslation();
	const role = useAuthStore((s) => s.user?.server_role);
	const config = useAdminConfig();
	const save = useUpdateAdminConfig();
	const [draft, setDraft] = useState<Record<string, ConfigValue>>({});
	const [askPassword, setAskPassword] = useState(false);

	if (config.isLoading) return <Loader2 className="animate-spin text-muted-foreground" />;
	const byKey = new Map<string, ConfigSetting>((config.data?.settings ?? []).map((s) => [s.key, s]));
	const stylesSetting = byKey.get('emoji.enabled_styles');
	const defaultSetting = byKey.get('emoji.default_style');
	if (!stylesSetting || !defaultSetting) {
		return <p className="text-sm text-muted-foreground">{t('admin.packs.unsupported')}</p>;
	}

	const value = (key: string): ConfigValue => (key in draft ? draft[key] : (byKey.get(key)?.value ?? ''));
	const allStyles = stylesSetting.options ?? [];
	const enabled = (value('emoji.enabled_styles') as string[]) ?? [];
	const defaultStyle = String(value('emoji.default_style'));
	const dirty = Object.entries(draft).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(byKey.get(k)?.value));
	const needsOwner = dirty.some(([k]) => byKey.get(k)?.owner_only);
	const problem = checkStyleSelection(enabled, defaultStyle);
	const limitInvalid = LIMIT_KEYS.some((k) => k in draft && (draft[k] === '' || Number(draft[k]) < (byKey.get(k)?.min ?? 1)));

	const styleName = (id: string) => t(`admin.packs.styles.${id}`, { defaultValue: id });

	const run = (password?: string) =>
		save.mutateAsync({ changes: Object.fromEntries(dirty), password }).then(() => {
			setDraft({});
			toast.success(t('admin.config.saved'));
		});

	return (
		<section className="space-y-6">
			<div>
				<h3 className="text-sm font-semibold text-foreground">{t('admin.packs.styles_title')}</h3>
				<p className="mb-2 text-xs text-muted-foreground">{t('admin.packs.styles_hint')}</p>
				<ul className="divide-y divide-border">
					{allStyles.map((id) => (
						<li key={id} className="flex items-center gap-3 py-2">
							<Checkbox
								id={`style-${id}`}
								checked={enabled.includes(id)}
								onCheckedChange={() => {
									const next = toggleStyle(allStyles, enabled, id, defaultStyle);
									setDraft((d) => ({ ...d, 'emoji.enabled_styles': next.enabled, 'emoji.default_style': next.defaultStyle }));
								}}
								disabled={defaultSetting.owner_only && role !== 'owner'}
							/>
							<label htmlFor={`style-${id}`} className="flex-1 cursor-pointer text-sm text-foreground">
								{styleName(id)}
							</label>
							{id === defaultStyle && <span className="text-xs font-medium text-primary">{t('admin.packs.default')}</span>}
						</li>
					))}
				</ul>
				<SettingRow title={t('admin.packs.default_style')}>
					<Select value={defaultStyle} onValueChange={(v) => setDraft((d) => ({ ...d, 'emoji.default_style': v }))}>
						<SelectTrigger className="w-44" aria-label={t('admin.packs.default_style')}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{enabled.map((id) => (
								<SelectItem key={id} value={id}>
									{styleName(id)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingRow>
				{problem && <p role="alert" className="text-xs text-destructive">{t(`admin.packs.problems.${problem}`)}</p>}
			</div>

			<div>
				<h3 className="mb-1 text-sm font-semibold text-foreground">{t('admin.packs.uploads_title')}</h3>
				<div className="divide-y divide-border">
					<SettingRow title={t('admin.packs.user_uploads')} description={t('admin.packs.user_uploads_hint')}>
						<Switch
							checked={Boolean(value('packs.user_uploads_enabled'))}
							onCheckedChange={(v) => setDraft((d) => ({ ...d, 'packs.user_uploads_enabled': v }))}
							aria-label={t('admin.packs.user_uploads')}
						/>
					</SettingRow>
					{LIMIT_KEYS.map((key) => {
						const s = byKey.get(key);
						if (!s) return null;
						return (
							<SettingRow key={key} title={t(`admin.packs.limits.${key}`)}>
								<Input
									className="w-28"
									type="number"
									min={s.min}
									max={s.max}
									value={String(value(key))}
									aria-label={t(`admin.packs.limits.${key}`)}
									onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value === '' ? '' : Number(e.target.value) }))}
								/>
							</SettingRow>
						);
					})}
				</div>
			</div>

			<div className="flex gap-2">
				<Button
					disabled={dirty.length === 0 || !!problem || limitInvalid || save.isPending}
					onClick={() => (needsOwner && role !== 'owner' ? setAskPassword(true) : run().catch((err) => toast.error(adminErrorMessage(t, err))))}
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
		</section>
	);
}
