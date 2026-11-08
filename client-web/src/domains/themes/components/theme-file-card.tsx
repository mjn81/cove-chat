import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Download, Eye, Loader2, Palette, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app.slice';
import { applyFromFile, installFile, startThemePreview } from '../api/theme-actions';
import { inspectThemeFile, type InspectResult } from '../api/inspect-theme-file';
import { useInstalledThemes } from '../hooks/use-installed-themes';
import { issueMessage } from '../utils/issue-message';
import { localizedThemeName } from '../utils/theme-name';
import { ThemePreview, ThemeSwatches } from './theme-preview';

interface ThemeFileCardProps {
	/** File name from the message metadata. */
	fileName: string;
	/** Size the sender claimed, in bytes. */
	size: number;
	/** Downloads and decrypts the file (the chat's own file helpers). */
	loadBytes: () => Promise<Uint8Array>;
	/** The ordinary file download, kept so the original `.covetheme` can still be saved. */
	onDownload: () => void;
	downloading: boolean;
}

type CardState = { status: 'loading' } | { status: 'done'; result: InspectResult };

/** "12.3 KB" / "1.2 MB". */
function formatSize(bytes: number): string {
	return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
}

/**
 * The chat card for a `.covetheme` file message. It downloads the file, runs the strict validator and shows what
 * the theme would look like (name, author, colour strip, a miniature chat in the theme's colours, licence, size).
 * Nothing is applied or installed until the user presses Preview (scoped, reversible) or Install; a file that does
 * not validate shows the reason instead of any theme.
 */
export function ThemeFileCard({ fileName, size, loadBytes, onDownload, downloading }: ThemeFileCardProps) {
	const { t, i18n } = useTranslation();
	const mode = useAppStore((s) => s.mode);
	const installed = useInstalledThemes();
	const [state, setState] = useState<CardState>({ status: 'loading' });
	const [installing, setInstalling] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void inspectThemeFile({ size, load: loadBytes }).then((result) => {
			if (!cancelled) setState({ status: 'done', result });
		});
		return () => {
			cancelled = true;
		};
	}, [size, loadBytes]);

	const downloadButton = (
		<Button type="button" size="sm" variant="ghost" disabled={downloading} onClick={onDownload}>
			{downloading ? <Loader2 className="animate-spin" /> : <Download />}
			{t('themes.card.download')}
		</Button>
	);

	if (state.status === 'loading') {
		return (
			<div className="flex w-full items-center gap-3 rounded-md border border-border bg-secondary p-3 text-sm text-muted-foreground">
				<Loader2 size={18} className="shrink-0 animate-spin text-primary" />
				<span className="truncate">{t('themes.card.checking', { name: fileName })}</span>
			</div>
		);
	}

	const { result } = state;
	if (!result.ok) {
		return (
			<div role="alert" className="w-full space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
				<div className="flex items-center gap-2 text-sm font-semibold text-destructive">
					<AlertTriangle size={16} className="shrink-0" />
					<span className="truncate">{t('themes.card.invalid', { name: fileName })}</span>
				</div>
				<ul className="list-disc space-y-0.5 ps-5 text-xs text-foreground">
					{result.errors.slice(0, 4).map((e, i) => (
						<li key={i}>{issueMessage(t, e)}</li>
					))}
				</ul>
				<p className="text-[11px] text-muted-foreground">{t('themes.card.not_applied')}</p>
				{downloadButton}
			</div>
		);
	}

	const { theme } = result;
	const name = localizedThemeName(theme.name, i18n.language);
	const isInstalled = installed.some((row) => row.id === theme.id);

	async function install() {
		setInstalling(true);
		try {
			const outcome = await installFile(result.ok ? result.bytes : new Uint8Array());
			if (outcome.ok) toast.success(t(outcome.replaced ? 'themes.import_replaced' : 'themes.import_ok', { name }));
			else toast.error(issueMessage(t, outcome.error));
		} finally {
			setInstalling(false);
		}
	}

	return (
		<div className="w-full space-y-3 rounded-md border border-border bg-secondary p-3">
			<div className="flex items-start gap-2">
				<Palette size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-semibold text-foreground">{name}</div>
					<div className="truncate text-[11px] text-muted-foreground">
						{theme.author ? t('themes.by_author', { author: theme.author }) : t('themes.card.no_author')}
					</div>
				</div>
			</div>
			<ThemePreview theme={theme} mode={mode} className="h-24" />
			<ThemeSwatches theme={theme} mode={mode} />
			<div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
				{theme.license && <span>{t('themes.card.license', { license: theme.license })}</span>}
				<span>{formatSize(size)}</span>
				{result.warnings.length > 0 && <span>{t('themes.card.notes', { count: result.warnings.length })}</span>}
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					size="sm"
					variant="secondary"
					onClick={() => startThemePreview({ theme, apply: applyFromFile(result.bytes) })}
				>
					<Eye />
					{t('themes.card.preview')}
				</Button>
				<Button type="button" size="sm" disabled={isInstalled || installing} onClick={() => void install()}>
					{isInstalled ? <Check /> : installing ? <Loader2 className="animate-spin" /> : <Plus />}
					{isInstalled ? t('themes.card.installed') : t('themes.card.install')}
				</Button>
				{downloadButton}
			</div>
		</div>
	);
}
