import { useMemo, useState } from 'react';
import { Download, Eye, Loader2, Save, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ForwardModal } from '@/components/Chat/ForwardModal';
import { FormField } from '@/components/form-field';
import { ModalShell } from '@/components/modal-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app.slice';
import { startThemePreview } from '../api/theme-actions';
import { draftToThemeFile, saveDraft } from '../api/theme-draft-actions';
import { saveThemeFile } from '../api/save-theme-file';
import type { ThemeAsset, ThemeDefinition, ThemeMode, ThemeTokenName, TokenSet } from '../types/themes.types';
import { COVETHEME_MIME } from '../utils/covetheme';
import { issueMessage } from '../utils/issue-message';
import {
	addLightVariant,
	draftFromTheme,
	draftIssues,
	draftToTheme,
	removeLightVariant,
	setDraftBackground,
	setDraftImage,
	setDraftToken,
	tokensOf,
	type DraftVariant,
	type ThemeDraft,
} from '../utils/theme-draft';
import { ThemeBackgroundEditor } from './theme-background-editor';
import { ThemeEditorColours } from './theme-editor-colours';
import { ThemeEditorSample } from './theme-editor-sample';

/** What the editor starts from. */
export interface ThemeEditorSource {
	theme: ThemeDefinition;
	assets: Record<string, ThemeAsset>;
	/** `true` for "create from this" (built-ins and duplicates); `false` edits an installed theme in place. */
	asCopy: boolean;
}

interface ThemeEditorProps {
	source: ThemeEditorSource;
	onClose: () => void;
}

/** Light/dark variant switch for dark-base themes that carry a light variant. */
function VariantSwitch({ variant, onChange }: { variant: DraftVariant; onChange: (v: DraftVariant) => void }) {
	const { t } = useTranslation();
	const options: Array<{ id: DraftVariant; label: string }> = [
		{ id: 'base', label: t('settings.dark') },
		{ id: 'light', label: t('settings.light') },
	];
	return (
		<div role="group" aria-label={t('themes.editor.variant')} className="inline-flex rounded-lg bg-secondary p-1">
			{options.map((o) => (
				<button
					key={o.id}
					type="button"
					aria-pressed={variant === o.id}
					onClick={() => onChange(o.id)}
					className={cn(
						'rounded-md px-3 py-1 text-xs font-medium transition-colors',
						variant === o.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
					)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

/**
 * Settings > Appearance > Themes > Create / Edit. Start from any theme, change the allow-listed colours with HSL
 * pickers against a live sample, fix weak contrast in one click, set a chat background (pattern, colour, gradient
 * or a cropped image), fill in name, author and licence, then save it on this device, export a `.covetheme` file,
 * share that file to a chat, or preview it across the whole app first (Apply or Revert in the floating bar).
 *
 * Saving goes through the same validator as an imported file, so what cannot be saved is explained, not dropped.
 */
export function ThemeEditor({ source, onClose }: ThemeEditorProps) {
	const { t } = useTranslation();
	const themeId = useAppStore((s) => s.themeId);
	const selectTheme = useAppStore((s) => s.selectTheme);
	const [draft, setDraft] = useState<ThemeDraft>(() => draftFromTheme(source.theme, source.assets, { asCopy: source.asCopy }));
	const [variant, setVariant] = useState<DraftVariant>('base');
	const [saving, setSaving] = useState(false);
	const [shareFile, setShareFile] = useState<File | null>(null);

	const activeVariant: DraftVariant = variant === 'light' && draft.light ? 'light' : 'base';
	const tokens = tokensOf(draft, activeVariant);
	const sampleMode: ThemeMode = activeVariant === 'light' ? 'light' : draft.base;
	const issues = useMemo(() => draftIssues(draft), [draft]);
	const canSave = issues.errors.length === 0 && !saving;

	const setToken = (name: ThemeTokenName, value: string) => setDraft((d) => setDraftToken(d, activeVariant, name, value));
	const replaceTokens = (next: TokenSet) => setDraft((d) => (activeVariant === 'light' ? { ...d, light: next } : { ...d, tokens: next }));
	const setText = (patch: Partial<Pick<ThemeDraft, 'author' | 'license'>>) => setDraft((d) => ({ ...d, ...patch }));

	async function save(): Promise<boolean> {
		setSaving(true);
		try {
			const result = await saveDraft(draft);
			if (!result.ok) {
				toast.error(issueMessage(t, result.error));
				return false;
			}
			// An edited theme that is in use must refresh the snapshot the app applies from.
			if (result.theme.id === themeId) selectTheme(result.theme);
			toast.success(t(result.replaced ? 'themes.import_replaced' : 'themes.import_ok', { name: result.theme.name.en }));
			return true;
		} finally {
			setSaving(false);
		}
	}

	async function saveAndClose() {
		if (await save()) onClose();
	}

	function preview() {
		startThemePreview({
			theme: draftToTheme(draft),
			apply: async () => {
				const result = await saveDraft(draft);
				if (!result.ok) return false;
				selectTheme(result.theme);
				return true;
			},
		});
	}

	async function exportFile() {
		try {
			const saved = await saveThemeFile(draftToThemeFile(draft));
			if (saved) toast.success(saved);
		} catch {
			toast.error(t('themes.export_failed'));
		}
	}

	function share() {
		const file = draftToThemeFile(draft);
		setShareFile(new File([file.bytes as BlobPart], file.fileName, { type: COVETHEME_MIME }));
	}

	return (
		<>
			<ModalShell
				open
				onOpenChange={(open) => {
					if (!open) onClose();
				}}
				title={t(source.asCopy ? 'themes.editor.title_new' : 'themes.editor.title_edit')}
				description={t('themes.editor.subtitle')}
				className="max-w-5xl"
				footer={
					<div className="flex w-full flex-wrap items-center justify-between gap-2">
						<div className="flex flex-wrap gap-2">
							<Button type="button" variant="secondary" size="sm" onClick={preview}>
								<Eye />
								{t('themes.editor.preview_app')}
							</Button>
							<Button type="button" variant="secondary" size="sm" disabled={issues.errors.length > 0} onClick={() => void exportFile()}>
								<Download />
								{t('themes.editor.export')}
							</Button>
							<Button type="button" variant="secondary" size="sm" disabled={issues.errors.length > 0} onClick={share}>
								<Send className="rtl:-scale-x-100" />
								{t('themes.editor.share')}
							</Button>
						</div>
						<div className="flex gap-2">
							<Button type="button" variant="ghost" onClick={onClose}>
								{t('common.cancel')}
							</Button>
							<Button type="button" disabled={!canSave} onClick={() => void saveAndClose()}>
								{saving ? <Loader2 className="animate-spin" /> : <Save />}
								{t('themes.editor.save')}
							</Button>
						</div>
					</div>
				}
			>
				<div className="grid gap-5 lg:grid-cols-2">
					<div className="order-2 min-w-0 space-y-6 lg:order-1">
						<section className="space-y-3">
							<h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('themes.editor.details')}</h3>
							<FormField label={t('themes.editor.name')} required>
								{(c) => (
									<Input
										{...c}
										value={draft.name.en}
										maxLength={40}
										autoComplete="off"
										autoCapitalize="off"
										onChange={(e) => setDraft((d) => ({ ...d, name: { ...d.name, en: e.target.value } }))}
									/>
								)}
							</FormField>
							<div className="grid gap-3 sm:grid-cols-2">
								<FormField label={t('themes.editor.name_fa')}>
									{(c) => (
										<Input
											{...c}
											dir="rtl"
											value={draft.name.fa ?? ''}
											maxLength={40}
											autoComplete="off"
											onChange={(e) => setDraft((d) => ({ ...d, name: { ...d.name, fa: e.target.value } }))}
										/>
									)}
								</FormField>
								<FormField label={t('themes.editor.name_ar')}>
									{(c) => (
										<Input
											{...c}
											dir="rtl"
											value={draft.name.ar ?? ''}
											maxLength={40}
											autoComplete="off"
											onChange={(e) => setDraft((d) => ({ ...d, name: { ...d.name, ar: e.target.value } }))}
										/>
									)}
								</FormField>
							</div>
							<div className="grid gap-3 sm:grid-cols-2">
								<FormField label={t('themes.editor.author')}>
									{(c) => <Input {...c} value={draft.author} maxLength={60} autoComplete="off" onChange={(e) => setText({ author: e.target.value })} />}
								</FormField>
								<FormField label={t('themes.editor.license')} hint={t('themes.editor.license_hint')}>
									{(c) => <Input {...c} value={draft.license} maxLength={40} autoComplete="off" onChange={(e) => setText({ license: e.target.value })} />}
								</FormField>
							</div>
						</section>

						<section className="space-y-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('themes.editor.colours')}</h3>
								{draft.base === 'dark' &&
									(draft.light ? (
										<div className="flex items-center gap-2">
											<VariantSwitch variant={activeVariant} onChange={setVariant} />
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() => {
													setDraft(removeLightVariant);
													setVariant('base');
												}}
											>
												{t('themes.editor.remove_light')}
											</Button>
										</div>
									) : (
										<Button
											type="button"
											size="sm"
											variant="secondary"
											onClick={() => {
												setDraft(addLightVariant);
												setVariant('light');
											}}
										>
											{t('themes.editor.add_light')}
										</Button>
									))}
							</div>
							<ThemeEditorColours tokens={tokens} onToken={setToken} onReplace={replaceTokens} />
						</section>

						<section className="space-y-3">
							<h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('themes.editor.background.title')}</h3>
							<ThemeBackgroundEditor
								background={draft.background}
								image={draft.image}
								onBackground={(config) => setDraft((d) => setDraftBackground(d, config))}
								onImage={(asset) => setDraft((d) => setDraftImage(d, asset))}
							/>
						</section>
					</div>

					<div className="order-1 min-w-0 lg:order-2">
						<div className="space-y-3 lg:sticky lg:top-0">
							<ThemeEditorSample tokens={tokens} mode={sampleMode} background={draft.background} image={draft.image} />
							{issues.errors.length > 0 && (
								<div role="alert" className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
									<div className="font-semibold text-destructive">{t('themes.editor.cannot_save')}</div>
									<ul className="list-disc space-y-0.5 ps-5 text-xs text-foreground">
										{issues.errors.slice(0, 6).map((e, i) => (
											<li key={i}>{issueMessage(t, e)}</li>
										))}
									</ul>
								</div>
							)}
							<p className="text-[11px] text-muted-foreground">{t('themes.editor.preview_hint')}</p>
						</div>
					</div>
				</div>
			</ModalShell>
			{shareFile && <ForwardModal outgoingFile={shareFile} title={t('themes.editor.share_title')} onClose={() => setShareFile(null)} />}
		</>
	);
}
