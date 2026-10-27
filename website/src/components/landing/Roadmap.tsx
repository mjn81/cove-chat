import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Circle, Loader } from 'lucide-react';
import { BlurFade } from './primitives';
import { getRoadmap, type RoadmapItem, type RoadmapStatus } from '@/lib/roadmap';
import { dict, localUrl, type Lang } from '@/i18n';

const PHASE_COLOR: Record<string, string> = {
  shipped: 'var(--success)',
  now: 'var(--warning)',
  next: 'var(--primary)',
  later: 'var(--muted-fg)',
  future: 'var(--muted-fg)',
};

function StatusIcon({ status, label }: { status: RoadmapStatus; label: string }) {
  return (
    <span className={`st ${status === 'done' ? 'done' : status === 'progress' ? 'wip' : ''}`} title={label} role="img" aria-label={label}>
      {status === 'done' ? <CheckCircle2 /> : status === 'progress' ? <Loader /> : <Circle />}
    </span>
  );
}

const PREVIEW_PHASES = ['shipped', 'now', 'next'];
const PREVIEW_COUNT = 6;

/** Shipped / In progress / Next preview for the landing page. Same height columns, "+N more" when truncated. */
export function RoadmapPreview({ lang }: { lang: Lang }) {
  const d = dict(lang).roadmap;
  const phases = useMemo(() => getRoadmap(lang).filter((p) => PREVIEW_PHASES.includes(p.id)), [lang]);
  return (
    <div className="road">
      {phases.map((p, i) => {
        const extra = p.items.length - PREVIEW_COUNT;
        return (
          <BlurFade key={p.id} delay={i * 0.08}>
            <div className="col">
              <header><span className="dot" style={{ background: PHASE_COLOR[p.id] }} />{p.title}</header>
              <div className="sub">{p.subtitle}</div>
              <div className="bar">
                <motion.i initial={{ scaleX: 0 }} whileInView={{ scaleX: Math.max(p.progress, 0.03) }} viewport={{ once: true }} transition={{ duration: 1.3, delay: 0.3 + i * 0.1, ease: [0.22, 1, 0.36, 1] }} />
              </div>
              {p.items.slice(0, PREVIEW_COUNT).map((it) => (
                <div className="item" key={it.id}>
                  <StatusIcon status={it.status} label={d.status[it.status]} />
                  <div>{it.title}</div>
                </div>
              ))}
              {extra > 0 && (
                <a className="item more" href={localUrl(lang, '/roadmap/')}>+{extra} {d.more}</a>
              )}
            </div>
          </BlurFade>
        );
      })}
    </div>
  );
}

/** Full roadmap timeline with an animated area filter. */
export function RoadmapTimeline({ lang }: { lang: Lang }) {
  const d = dict(lang).roadmap;
  const phases = useMemo(() => getRoadmap(lang), [lang]);
  const areas = useMemo(() => ['all', ...Array.from(new Set(phases.flatMap((p) => p.items.map((i) => i.area))))], [phases]);
  const [area, setArea] = useState('all');
  const match = (it: RoadmapItem) => area === 'all' || it.area === area;
  const areaName = (a: string) => (a === 'all' ? d.all : (d.areas as Record<string, string>)[a] ?? a);
  return (
    <>
      <div className="filters" role="tablist" aria-label={d.filterLabel}>
        {areas.map((a) => (
          <button key={a} type="button" role="tab" aria-selected={area === a} className={`filter ${area === a ? 'on' : ''}`} onClick={() => setArea(a)}>
            {area === a && <motion.span layoutId="filter-bg" className="bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <span>{areaName(a)}</span>
          </button>
        ))}
      </div>
      <div className="timeline">
        {phases.map((p) => {
          const list = p.items.filter(match);
          if (!list.length) return null;
          return (
            <BlurFade key={p.id} className="phase">
              <h3>{p.title}</h3>
              <p>{p.subtitle}</p>
              <AnimatePresence mode="popLayout">
                {list.map((it) => (
                  <motion.div layout key={it.id} className="rcard" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.3 }}>
                    <StatusIcon status={it.status} label={d.status[it.status]} />
                    <div><b>{it.title}</b><p>{it.note}</p></div>
                    <span className="area">{areaName(it.area)}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </BlurFade>
          );
        })}
      </div>
    </>
  );
}
