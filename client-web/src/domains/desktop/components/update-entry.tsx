import { MarkdownText } from '@/components/markdown-text';
import { useTranslation } from 'react-i18next';
import { CircleArrowDown, ExternalLink, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isWails } from '@/utils/wails';
import { DownloadUpdate } from '@/wailsjs/go/main/App';
import { useInstallUpdate } from '../hooks/use-desktop-update';
import { useDesktopUpdateStore } from '../store/update.store';
import { entryKind } from '../utils/update-state';
import { RestartConfirmDialog } from './restart-confirm-dialog';

/**
 * The update icon of the desktop app. It sits in its own row directly above the profile footer of the left sidebar
 * (below the call bar when one is showing, so the two stack without overlapping) and appears only when a newer
 * version was found. It is deliberately small and quiet: a dot on the icon, a tooltip, and a popover with the
 * version, what is new and the next step. Nothing is downloaded or installed until the user clicks.
 *
 * Renders nothing in a browser or while there is nothing to offer.
 */
export function UpdateEntry({ collapsed = false }: { collapsed?: boolean }) {
	const { t } = useTranslation();
	const state = useDesktopUpdateStore((s) => s.state);
	const install = useInstallUpdate();
	const kind = entryKind(state);
	if (!isWails() || !state || !kind) return null;

	const version = state.latest_version;
	const label = kind === 'restart' ? t('desktopUpdate.entry.ready', { version }) : t('desktopUpdate.entry.available', { version });
	const busy = kind === 'downloading';

	return (
		<TooltipProvider delayDuration={150}>
		<div className={cn('flex shrink-0 px-2 pb-1', collapsed ? 'justify-center' : 'justify-end')}>
			<Popover>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="relative size-8 text-primary"
								aria-label={label}
							>
								{busy ? <Loader2 className="size-4 animate-spin" /> : <CircleArrowDown className="size-4" />}
								<span
									aria-hidden="true"
									className="absolute end-1 top-1 size-2 rounded-full border border-secondary bg-primary"
								/>
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side={collapsed ? 'right' : 'top'}>{label}</TooltipContent>
				</Tooltip>
				<PopoverContent side={collapsed ? 'right' : 'top'} align="end" className="w-72 space-y-3 p-3 text-sm">
					<div>
						<p className="font-medium text-foreground">{label}</p>
						<p className="text-xs text-muted-foreground" dir="ltr">
							{state.current_version} → {version}
						</p>
					</div>
					{state.release_notes && (
						<div>
							<p className="mb-1 text-xs font-medium text-foreground">{t('desktopUpdate.entry.notes')}</p>
							<MarkdownText
								mode="document"
								text={state.release_notes}
								className="max-h-32 overflow-y-auto break-words text-xs text-muted-foreground"
							/>
						</div>
					)}
					{kind === 'downloading' && (
						<div className="space-y-1" role="status" aria-live="polite">
							<Progress value={state.progress_percent} />
							<p className="text-xs text-muted-foreground">
								{t('desktopUpdate.status.downloading', { version, percent: state.progress_percent })}
							</p>
						</div>
					)}
					{kind === 'download' && (
						<Button size="sm" className="w-full" onClick={() => void DownloadUpdate()}>
							{t('desktopUpdate.banner.download')}
						</Button>
					)}
					{kind === 'restart' && (
						<Button size="sm" className="w-full" onClick={install.request} disabled={install.installing}>
							{t('desktopUpdate.banner.restart')}
						</Button>
					)}
					{kind === 'manual' && state.release_url && (
						<Button size="sm" className="w-full" asChild>
							<a href={state.release_url} target="_blank" rel="noreferrer">
								{t('desktopUpdate.banner.download')}
								<ExternalLink className="rtl:-scale-x-100" />
							</a>
						</Button>
					)}
				</PopoverContent>
			</Popover>
			<RestartConfirmDialog controls={install} version={version} />
		</div>
		</TooltipProvider>
	);
}
