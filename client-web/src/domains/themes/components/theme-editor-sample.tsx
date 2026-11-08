import type { CSSProperties } from 'react';
import { Hash, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatBackgroundConfig, ThemeAsset, TokenSet } from '../types/themes.types';
import type { ThemeMode } from '../types/themes.types';
import { useAssetBlobUrl } from '../hooks/use-asset-blob-url';
import { chatBackgroundStyle } from '../utils/chat-background-style';
import { CHAT_PATTERN_URLS } from '../utils/chat-pattern-assets';
import { tokensToCssVars } from '../utils/tokens';

interface ThemeEditorSampleProps {
	/** The colours being edited (complete set). */
	tokens: TokenSet;
	/** The mode class to set, so `dark:` utilities inside match the colours. */
	mode: ThemeMode;
	background: ChatBackgroundConfig;
	image: ThemeAsset | null;
}

/**
 * A small but complete sample of the app drawn in the draft's colours: sidebar, message list with other and own
 * messages and a mention, composer, buttons and a dialog. The tokens are custom properties on this element only,
 * so editing never changes the real app (that is what Preview is for).
 */
export function ThemeEditorSample({ tokens, mode, background, image }: ThemeEditorSampleProps) {
	const { t } = useTranslation();
	const imageUrl = useAssetBlobUrl(background.type === 'image' ? image : null);
	const bgStyle = chatBackgroundStyle(background, {
		strength: 0.08,
		patternUrl: background.type === 'pattern' ? CHAT_PATTERN_URLS[background.pattern] : undefined,
		imageUrl,
	});

	return (
		<div
			style={tokensToCssVars(tokens) as CSSProperties}
			className={cn(mode, 'overflow-hidden rounded-lg border border-border bg-background text-foreground')}
		>
			<div className="flex h-72">
				<div className="flex w-24 shrink-0 flex-col gap-1 border-e border-border bg-card p-2 text-card-foreground sm:w-28">
					<div className="mb-1 truncate text-[11px] font-bold">{t('themes.editor.sample.server')}</div>
					{['general', 'design', 'random'].map((name, i) => (
						<div
							key={name}
							className={cn(
								'flex items-center gap-1 truncate rounded px-1.5 py-1 text-[11px]',
								i === 0 ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
							)}
						>
							<Hash size={10} className="shrink-0" />
							{name}
						</div>
					))}
					<div className="mt-auto rounded bg-muted px-1.5 py-1 text-[10px] text-muted-foreground">{t('themes.editor.sample.muted')}</div>
				</div>

				<div className="flex min-w-0 flex-1 flex-col">
					<div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs font-semibold">
						<Hash size={12} className="text-muted-foreground" />
						general
					</div>
					<div className="relative flex-1 overflow-hidden">
						{bgStyle && <div className="pointer-events-none absolute inset-0" style={bgStyle} />}
						<div className="relative flex h-full flex-col justify-end gap-1.5 p-3">
							<div className="max-w-[80%] self-start rounded-lg rounded-es-sm bg-secondary px-2.5 py-1.5 text-xs text-secondary-foreground">
								{t('themes.editor.sample.other')}
							</div>
							<div className="max-w-[80%] self-end rounded-lg rounded-ee-sm bg-primary px-2.5 py-1.5 text-xs text-primary-foreground">
								{t('themes.editor.sample.own')}
							</div>
							<div className="max-w-[80%] self-start rounded-lg rounded-es-sm border border-mention-border bg-mention px-2.5 py-1.5 text-xs text-mention-foreground">
								{t('themes.editor.sample.mention')}
							</div>
						</div>
					</div>
					<div className="flex items-center gap-2 border-t border-border p-2">
						<div className="flex-1 truncate rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
							{t('themes.editor.sample.composer')}
						</div>
						<div className="rounded-md bg-primary p-1.5 text-primary-foreground">
							<Send size={12} />
						</div>
					</div>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2 border-t border-border bg-card p-3">
				<Button size="sm" tabIndex={-1}>{t('themes.editor.sample.primary')}</Button>
				<Button size="sm" variant="secondary" tabIndex={-1}>{t('themes.editor.sample.secondary')}</Button>
				<Button size="sm" variant="destructive" tabIndex={-1}>{t('themes.editor.sample.danger')}</Button>
				<span className="rounded bg-success px-1.5 py-0.5 text-[10px] font-semibold text-success-foreground">{t('themes.editor.sample.ok')}</span>
				<span className="rounded bg-warning px-1.5 py-0.5 text-[10px] font-semibold text-warning-foreground">{t('themes.editor.sample.warn')}</span>
			</div>

			<div className="border-t border-border bg-background p-3">
				<div className="mx-auto max-w-xs rounded-lg border border-border bg-popover p-3 text-popover-foreground">
					<div className="text-sm font-semibold">{t('themes.editor.sample.dialog_title')}</div>
					<div className="mt-0.5 text-xs text-muted-foreground">{t('themes.editor.sample.dialog_body')}</div>
					<div className="mt-2 flex justify-end gap-2">
						<Button size="sm" variant="ghost" tabIndex={-1}>{t('themes.editor.sample.cancel')}</Button>
						<Button size="sm" tabIndex={-1}>{t('themes.editor.sample.confirm')}</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
