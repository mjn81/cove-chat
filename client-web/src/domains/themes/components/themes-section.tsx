import { useRef, useState } from 'react';
import { Download, Moon, Plus, RotateCcw, Sun, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app.slice';
import { dexieThemeStore } from '../api/dexie-theme-store';
import { saveThemeFile } from '../api/save-theme-file';
import { applyKnown, startThemePreview } from '../api/theme-actions';
import { deleteInstalledTheme, exportThemeFile, installThemeFromBytes } from '../api/theme-library';
import { BUILTIN_THEMES, DEFAULT_THEME_ID, getBuiltinTheme, isBuiltinThemeId } from '../data/builtin-themes';
import { useInstalledThemes } from '../hooks/use-installed-themes';
import type { ThemeDefinition, ThemeMode } from '../types/themes.types';
import { COVETHEME_EXTENSION, COVETHEME_LIMITS } from '../utils/covetheme';
import { issueMessage } from '../utils/issue-message';
import { localizedThemeName } from '../utils/theme-name';
import { resolveTheme, supportsBothModes } from '../utils/resolve-theme';
import { definitionFor } from '../utils/theme-settings';
import type { ThemeIssue } from '../utils/tokens';
import { ThemeCard } from './theme-card';
import { ThemeEditor, type ThemeEditorSource } from './theme-editor';

/** What the last import attempt left on screen. */
type ImportState =
	| { kind: 'idle' }
	| { kind: 'busy' }
	| { kind: 'ok'; theme: ThemeDefinition; replaced: boolean; warnings: ThemeIssue[] }
	| { kind: 'error'; errors: ThemeIssue[] };

/** Light/dark switch. */
function ModeToggle({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
	const { t } = useTranslation();
	const options: Array<{ id: ThemeMode; label: string; icon: typeof Moon }> = [
		{ id: 'dark', label: t('settings.dark'), icon: Moon },
		{ id: 'light', label: t('settings.light'), icon: Sun },
	];
	return (
		<div role="group" aria-label={t('themes.mode')} className="inline-flex rounded-lg bg-secondary p-1">
			{options.map(({ id, label, icon: Icon }) => (
				<button
					key={id}
					type="button"
					onClick={() => onChange(id)}
					aria-pressed={mode === id}
					className={cn(
						'flex select-none items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
						mode === id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
					)}
				>
					<Icon size={14} />
					{label}
				</button>
			))}
		</div>
	);
}

/**
 * Settings > Appearance > Themes: light/dark mode, built-in and installed themes with live previews, importing and
 * exporting `.covetheme` files, and deleting installed themes.
 */
export function ThemesSection() {
	const { t, i18n } = useTranslation();
	const mode = useAppStore((s) => s.mode);
	const themeId = useAppStore((s) => s.themeId);
	const customTheme = useAppStore((s) => s.customTheme);
	const chatBackground = useAppStore((s) => s.chatBackground);
	const setMode = useAppStore((s) => s.setMode);
	const selectTheme = useAppStore((s) => s.selectTheme);
	const resetTheme = useAppStore((s) => s.resetTheme);
	const installed = useInstalledThemes();
	const fileInput = useRef<HTMLInputElement>(null);
	const [importState, setImportState] = useState<ImportState>({ kind: 'idle' });
	const [editor, setEditor] = useState<ThemeEditorSource | null>(null);

	const current = definitionFor(themeId, customTheme);
	const nameOf = (theme: ThemeDefinition) => localizedThemeName(theme.name, i18n.language);
	const effective = resolveTheme(current, mode).mode;

	async function handleFile(file: File) {
		setImportState({ kind: 'busy' });
		try {
			if (file.size > COVETHEME_LIMITS.maxArchiveBytes) {
				setImportState({ kind: 'error', errors: [{ code: 'zip_too_large' }] });
				return;
			}
			const bytes = new Uint8Array(await file.arrayBuffer());
			const result = await installThemeFromBytes(bytes, dexieThemeStore);
			if (!result.ok) {
				setImportState({ kind: 'error', errors: result.errors });
				return;
			}
			setImportState({ kind: 'ok', theme: result.theme, replaced: result.replaced, warnings: result.warnings });
			toast.success(t(result.replaced ? 'themes.import_replaced' : 'themes.import_ok', { name: nameOf(result.theme) }));
			// Re-selecting an updated theme refreshes the snapshot the app applies from.
			if (result.replaced && result.theme.id === themeId) selectTheme(result.theme);
		} catch {
			setImportState({ kind: 'error', errors: [{ code: 'unknown' }] });
		}
	}

	async function handleExport() {
		try {
			const saved = await saveThemeFile(await exportThemeFile(current, dexieThemeStore));
			if (saved) toast.success(saved);
		} catch {
			toast.error(t('themes.export_failed'));
		}
	}

	/** Opens the editor on a theme: installed ones keep their id and images, anything else becomes a copy. */
	async function openEditor(theme: ThemeDefinition, inPlace: boolean) {
		try {
			const assets = inPlace ? ((await dexieThemeStore.get(theme.id))?.assets ?? {}) : {};
			setEditor({ theme, assets, asCopy: !inPlace });
		} catch {
			toast.error(t('themes.edit_failed'));
		}
	}

	const handlePreview = (theme: ThemeDefinition) => startThemePreview({ theme, apply: applyKnown(theme) });

	async function handleDelete(theme: ThemeDefinition) {
		try {
			await deleteInstalledTheme(theme.id, dexieThemeStore);
			if (theme.id === themeId) selectTheme(getBuiltinTheme(DEFAULT_THEME_ID) as ThemeDefinition);
			toast.success(t('themes.deleted', { name: nameOf(theme) }));
		} catch {
			toast.error(t('themes.delete_failed'));
		}
	}

	return (
		<section className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('themes.title')}</h3>
				<ModeToggle mode={mode} onChange={setMode} />
			</div>
			{!supportsBothModes(current) && (
				<p className="text-xs text-muted-foreground">
					{t('themes.single_mode', { mode: t(effective === 'dark' ? 'settings.dark' : 'settings.light') })}
				</p>
			)}

			<div>
				<h4 className="mb-2 text-xs font-semibold text-muted-foreground">{t('themes.builtin')}</h4>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{BUILTIN_THEMES.map((theme) => (
						<ThemeCard
							key={theme.id}
							theme={theme}
							mode={mode}
							selected={themeId === theme.id}
							onSelect={selectTheme}
							onPreview={handlePreview}
							onEdit={(th) => void openEditor(th, false)}
							origin="builtin"
						/>
					))}
				</div>
			</div>

			<div>
				<h4 className="mb-2 text-xs font-semibold text-muted-foreground">{t('themes.installed')}</h4>
				{installed.length === 0 ? (
					<p className="text-xs text-muted-foreground">{t('themes.installed_empty')}</p>
				) : (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						{installed.map((row) => (
							<ThemeCard
								key={row.id}
								theme={row.definition}
								mode={mode}
								selected={themeId === row.id}
								onSelect={selectTheme}
								onDelete={handleDelete}
								onPreview={handlePreview}
								onEdit={(th) => void openEditor(th, true)}
								origin="file"
							/>
						))}
					</div>
				)}
			</div>

			<div className="space-y-3">
				<div className="flex flex-wrap gap-2">
					<Button type="button" variant="secondary" size="sm" disabled={importState.kind === 'busy'} onClick={() => fileInput.current?.click()}>
						<Upload />
						{importState.kind === 'busy' ? t('themes.importing') : t('themes.import')}
					</Button>
					<Button type="button" variant="secondary" size="sm" onClick={() => void openEditor(current, !isBuiltinThemeId(current.id))}>
						<Plus />
						{t('themes.editor.create')}
					</Button>
					<Button type="button" variant="secondary" size="sm" onClick={handleExport}>
						<Download />
						{t('themes.export')}
					</Button>
					<Button type="button" variant="ghost" size="sm" disabled={themeId === DEFAULT_THEME_ID && chatBackground === 'none'} onClick={() => {
						resetTheme();
						toast.success(t('themes.reset_done'));
					}}>
						<RotateCcw />
						{t('themes.reset')}
					</Button>
					<input
						ref={fileInput}
						type="file"
						accept={`${COVETHEME_EXTENSION},application/vnd.cove.theme+zip`}
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = ''; // picking the same file again must fire onChange again
							if (file) void handleFile(file);
						}}
					/>
				</div>
				<p className="text-[11px] text-muted-foreground">{t('themes.import_hint')}</p>
				<ImportResult state={importState} onUse={selectTheme} nameOf={nameOf} />
			</div>
			{editor && <ThemeEditor key={editor.theme.id} source={editor} onClose={() => setEditor(null)} />}
		</section>
	);
}

/** The outcome panel under the import button: what was installed, notes about anything dropped, or what is wrong. */
function ImportResult({
	state,
	onUse,
	nameOf,
}: {
	state: ImportState;
	onUse: (theme: ThemeDefinition) => void;
	nameOf: (theme: ThemeDefinition) => string;
}) {
	const { t } = useTranslation();
	if (state.kind === 'idle' || state.kind === 'busy') return null;

	if (state.kind === 'error') {
		return (
			<div role="alert" className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
				<div className="font-semibold text-destructive">{t('themes.import_failed')}</div>
				<ul className="list-disc space-y-0.5 ps-5 text-xs text-foreground">
					{state.errors.slice(0, 6).map((e, i) => (
						<li key={i}>{issueMessage(t, e)}</li>
					))}
				</ul>
			</div>
		);
	}

	return (
		<div role="status" className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="font-semibold">
					{t(state.replaced ? 'themes.import_replaced' : 'themes.import_ok', { name: nameOf(state.theme) })}
				</div>
				<Button type="button" size="sm" onClick={() => onUse(state.theme)}>
					{t('themes.use_now')}
				</Button>
			</div>
			{state.warnings.length > 0 && (
				<div>
					<div className="text-xs font-semibold text-muted-foreground">{t('themes.notes')}</div>
					<ul className="list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">
						{state.warnings.slice(0, 8).map((w, i) => (
							<li key={i}>{issueMessage(t, w)}</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
