import { en, type Dict } from './en';
import { fa } from './fa';
import { ar } from './ar';
import { url } from '@/lib/site';

export type { Dict };
export const LANGS = ['en', 'fa', 'ar'] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_META: Record<Lang, { label: string; short: string; dir: 'ltr' | 'rtl' }> = {
  en: { label: 'English', short: 'EN', dir: 'ltr' },
  fa: { label: 'فارسی', short: 'FA', dir: 'rtl' },
  ar: { label: 'العربية', short: 'AR', dir: 'rtl' },
};

const DICTS: Record<Lang, Dict> = { en, fa, ar };

/** @returns the string dictionary for `lang`. */
export function dict(lang: Lang): Dict {
  return DICTS[lang];
}

/** English lives at the site root; other languages get a `/fa` or `/ar` prefix. */
export function langPrefix(lang: Lang): string {
  return lang === 'en' ? '' : `/${lang}`;
}

/** Base-aware URL of `path` (starting with `/`) in `lang`. Works for landing pages and docs alike. */
export function localUrl(lang: Lang, path: string): string {
  return url(`${langPrefix(lang)}${path}`);
}

/**
 * Maps the current pathname to the same page in another language.
 * @param pathname `location.pathname`, including Astro's base.
 */
export function switchLangPath(pathname: string, to: Lang): string {
  const base = url('/').replace(/\/$/, '');
  let rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  for (const l of LANGS) {
    if (l !== 'en' && (rest === `/${l}` || rest.startsWith(`/${l}/`))) {
      rest = rest.slice(l.length + 1) || '/';
      break;
    }
  }
  return url(`${langPrefix(to)}${rest || '/'}`);
}

/** Type guard for route params. */
export function isLang(value: string | undefined): value is Lang {
  return value !== undefined && (LANGS as readonly string[]).includes(value);
}
