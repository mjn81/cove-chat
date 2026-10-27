import { parse } from 'yaml';
import baseYaml from '@/data/roadmap.yaml?raw';
import faYaml from '@/data/roadmap.fa.yaml?raw';
import arYaml from '@/data/roadmap.ar.yaml?raw';
import type { Lang } from '@/i18n';

export type RoadmapStatus = 'done' | 'progress' | 'planned';

export interface RoadmapItem {
  id: string;
  phase: string;
  status: RoadmapStatus;
  area: string;
  title: string;
  note: string;
}

export interface RoadmapPhase {
  id: string;
  title: string;
  subtitle: string;
  items: RoadmapItem[];
  /** Share of items that are done, computed so nobody maintains a percentage by hand. */
  progress: number;
}

interface RawItem { id: string; area: string; title: string; note: string; status?: RoadmapStatus }
interface RawPhase { id: string; title: string; subtitle: string; status: RoadmapStatus; items: RawItem[] }
interface Translation {
  phases?: Record<string, { title?: string; subtitle?: string }>;
  items?: Record<string, { title?: string; note?: string }>;
}

const base = parse(baseYaml) as { phases: RawPhase[] };
const translations: Partial<Record<Lang, Translation>> = {
  fa: parse(faYaml) as Translation,
  ar: parse(arYaml) as Translation,
};

/**
 * Builds the roadmap for a language from `data/roadmap.yaml`, overlaying `roadmap.<lang>.yaml`
 * where it has an entry for the same id. Anything untranslated falls back to English.
 */
export function getRoadmap(lang: Lang): RoadmapPhase[] {
  const tr = translations[lang];
  return base.phases.map((p) => {
    const items: RoadmapItem[] = p.items.map((i) => ({
      id: i.id,
      phase: p.id,
      area: i.area,
      status: i.status ?? p.status,
      title: tr?.items?.[i.id]?.title ?? i.title,
      note: tr?.items?.[i.id]?.note ?? i.note,
    }));
    const done = items.filter((i) => i.status === 'done').length;
    return {
      id: p.id,
      title: tr?.phases?.[p.id]?.title ?? p.title,
      subtitle: tr?.phases?.[p.id]?.subtitle ?? p.subtitle,
      items,
      progress: items.length ? done / items.length : 0,
    };
  });
}
