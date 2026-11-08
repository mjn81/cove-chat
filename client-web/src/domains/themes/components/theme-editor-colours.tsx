import { AlertTriangle, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ThemeTokenName, TokenSet } from '../types/themes.types';
import { autoFixTokens, contrastIssues } from '../utils/contrast-fix';
import { TOKEN_GROUPS } from '../utils/token-groups';
import { HslColorPicker } from './hsl-color-picker';

interface ThemeEditorColoursProps {
	tokens: TokenSet;
	onToken: (name: ThemeTokenName, value: string) => void;
	/** Replaces the whole set (used by "Fix all"). */
	onReplace: (tokens: TokenSet) => void;
}

/**
 * The colour list of the editor, grouped, plus the contrast panel: every text/surface pair under AA with its ratio
 * and a one-click fix, and "Fix all". Pairs under 3:1 are marked as blocking, because the theme could not be saved.
 */
export function ThemeEditorColours({ tokens, onToken, onReplace }: ThemeEditorColoursProps) {
	const { t } = useTranslation();
	const issues = contrastIssues(tokens);

	return (
		<div className="space-y-4">
			{issues.length > 0 && (
				<div role="status" className="space-y-2 rounded-md border border-border bg-secondary p-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2 text-sm font-semibold">
							<AlertTriangle size={14} className="text-warning" aria-hidden="true" />
							{t('themes.editor.contrast_title', { count: issues.length })}
						</div>
						<Button type="button" size="sm" variant="secondary" onClick={() => onReplace(autoFixTokens(tokens))}>
							<Wand2 />
							{t('themes.editor.fix_all')}
						</Button>
					</div>
					<ul className="space-y-1.5">
						{issues.map((issue) => (
							<li key={`${issue.foreground}/${issue.surface}`} className="flex flex-wrap items-center gap-2 text-xs">
								<span className="min-w-0 flex-1">
									{t('themes.editor.contrast_pair', {
										text: t(`themes.tokens.${issue.foreground}`),
										surface: t(`themes.tokens.${issue.surface}`),
										ratio: issue.ratio.toFixed(1),
									})}
									{issue.level === 'error' && <span className="ms-1 font-semibold text-destructive">{t('themes.editor.blocking')}</span>}
								</span>
								{issue.fix && (
									<Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onToken(issue.foreground, issue.fix as string)}>
										{t('themes.editor.fix')}
									</Button>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{TOKEN_GROUPS.map((group) => (
				<div key={group.id}>
					<h4 className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
						{t(`themes.editor.groups.${group.id}`)}
					</h4>
					<div className="space-y-0.5">
						{group.tokens.map((name) => (
							<HslColorPicker key={name} label={t(`themes.tokens.${name}`)} value={tokens[name]} onChange={(v) => onToken(name, v)} />
						))}
					</div>
				</div>
			))}
		</div>
	);
}
