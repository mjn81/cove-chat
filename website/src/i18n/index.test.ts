import { describe, expect, it } from 'vitest';
import { LANGS, LANG_META, dict, isLang, localUrl, switchLangPath } from './index';
import { getRoadmap } from '@/lib/roadmap';

/** Dotted paths of every leaf, with array indexes, so a missing list item counts as a missing key. */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

describe('languages', () => {
  it('offers Russian as a left-to-right language', () => {
    expect(isLang('ru')).toBe(true);
    expect(LANG_META.ru).toMatchObject({ label: 'Русский', short: 'RU', dir: 'ltr', numberLocale: 'ru-RU' });
  });

  it.each(LANGS)('%s provides exactly the English keys', (lang) => {
    expect(leafPaths(dict(lang)).sort()).toEqual(leafPaths(dict('en')).sort());
  });

  it('keeps the separator the hero demo splits the call subtitle on', () => {
    for (const lang of LANGS) expect(dict(lang).hero.callSub, lang).toContain(' - ');
  });

  it('prefixes and swaps Russian paths', () => {
    expect(localUrl('ru', '/download/')).toBe('/ru/download/');
    expect(switchLangPath('/download/', 'ru')).toBe('/ru/download/');
    expect(switchLangPath('/ru/roadmap/', 'en')).toBe('/roadmap/');
    expect(switchLangPath('/fa/', 'ru')).toBe('/ru/');
  });

  it('translates every roadmap phase and item into Russian', () => {
    const english = getRoadmap('en');
    getRoadmap('ru').forEach((phase, p) => {
      expect(phase.title, phase.id).not.toBe(english[p].title);
      phase.items.forEach((item, i) => expect(item.note, item.id).not.toBe(english[p].items[i].note));
    });
  });
});
