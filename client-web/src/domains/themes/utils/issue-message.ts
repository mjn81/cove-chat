import type { TFunction } from 'i18next';
import type { ThemeIssue } from './tokens';

/**
 * Localised text for a validation problem. Issues carry a stable `code`; the wording lives in the locale files
 * under `themes.issues.<code>`, so the validator itself stays free of UI strings.
 *
 * @param t The i18next translate function.
 * @param issue An error or warning from the parser or installer.
 */
export function issueMessage(t: TFunction, issue: ThemeIssue): string {
	return t(`themes.issues.${issue.code}`, {
		detail: issue.detail ?? '',
		defaultValue: t('themes.issues.unknown'),
	});
}
