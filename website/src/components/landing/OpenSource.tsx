import { ArrowRight, BookOpen, CircleHelp, GitFork, Plus, Scale, Star } from 'lucide-react';
import { BlurFade, BorderBeam, GithubIcon, NumberTicker } from './primitives';
import { DISCUSSIONS_URL, GOOD_FIRST_ISSUES_URL, REPO_URL } from '@/lib/site';
import { dict, localUrl, type Lang } from '@/i18n';

interface Stat { value: number; label: string; suffix?: string }

/** Open-source block: live numbers when GitHub was reachable at build time, plain facts otherwise. */
export function OpenSource({ stars, lang }: { stars: number | null; lang: Lang }) {
  const d = dict(lang).oss;
  const stats: Stat[] = [
    ...(stars !== null ? [{ value: stars, label: d.stats.stars }] : []),
    { value: 3, label: d.stats.clients },
    { value: 3, label: d.stats.langs },
    { value: 100, label: d.stats.open, suffix: '%' },
  ];
  return (
    <>
      <div className="stats">
        {stats.map((s, i) => (
          <BlurFade key={s.label} delay={i * 0.06}>
            <div className="stat"><strong><NumberTicker value={s.value} />{s.suffix}</strong><span>{s.label}</span></div>
          </BlurFade>
        ))}
      </div>
      <BlurFade delay={0.1}>
        <div className="cta" style={{ marginTop: 32 }}>
          <a className="btn primary" href={REPO_URL} target="_blank" rel="noopener noreferrer"><GithubIcon />{d.repo}</a>
          <a className="btn" href={GOOD_FIRST_ISSUES_URL} target="_blank" rel="noopener noreferrer"><Star />{d.issues}</a>
          <a className="btn" href={DISCUSSIONS_URL} target="_blank" rel="noopener noreferrer"><GitFork />{d.discussions}</a>
          <a className="btn" href={localUrl(lang, '/docs/contributing/development/')}><BookOpen />{d.contributing}</a>
          <a className="btn" href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer"><Scale />{d.license}</a>
        </div>
      </BlurFade>
    </>
  );
}

/** Accordion with a smooth height transition (grid-rows trick, no JS measuring). */
export function Faq({ lang }: { lang: Lang }) {
  const d = dict(lang).faq;
  return (
    <div className="faq">
      {d.items.map((f, i) => (
        <BlurFade key={f.q} delay={i * 0.04}>
          <details open={i === 0}>
            <summary>{f.q}<Plus /></summary>
            <div className="ans"><p>{f.a}</p></div>
          </details>
        </BlurFade>
      ))}
    </div>
  );
}

/** Closing call to action. */
export function FinalCta({ lang }: { lang: Lang }) {
  const d = dict(lang).final;
  return (
    <BlurFade>
      <div className="final beam-host">
        <BorderBeam size={260} duration={12} />
        <h2>{d.title}</h2>
        <p className="lead" style={{ marginInline: 'auto', marginBottom: 28 }}>{d.lead}</p>
        <div className="cta">
          <a className="btn primary" href={localUrl(lang, '/docs/getting-started/quick-start/')}>{d.start} <ArrowRight className="rtl-flip" /></a>
          <a className="btn" href={localUrl(lang, '/docs/')}><CircleHelp />{d.docs}</a>
        </div>
      </div>
    </BlurFade>
  );
}
