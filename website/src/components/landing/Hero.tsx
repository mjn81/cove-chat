import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Code2, Download, Lock, Server, ShieldCheck, Smartphone, Star } from 'lucide-react';
import { GithubIcon } from './primitives';
import CoveDemo from './CoveDemo';
import { REPO_URL } from '@/lib/site';
import { dict, localUrl, type Lang } from '@/i18n';

const EASE = [0.22, 1, 0.36, 1] as const;

/** Headline revealed word by word. */
function Headline({ phrases }: { phrases: string[] }) {
  const reduce = useReducedMotion();
  let index = 0;
  return (
    <h1 aria-label={phrases.join(' ')}>
      {phrases.map((phrase, pi) => (
        // A phrase never breaks across lines, so wrapping only happens between phrases ('Your keys.' stays whole).
        <span key={pi} aria-hidden="true" style={{ display: 'inline-block', whiteSpace: 'nowrap', marginInlineEnd: '0.24em' }}>
          {phrase.split(' ').map((w, wi) => {
            const i = index++;
            return (
              <motion.span
                key={wi}
                className={pi === phrases.length - 1 ? 'grad' : undefined}
                style={{ display: 'inline-block', marginInlineEnd: wi === phrase.split(' ').length - 1 ? 0 : '0.24em' }}
                initial={reduce ? false : { opacity: 0, y: 28, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.8, delay: 0.1 + i * 0.07, ease: EASE }}
              >
                {w}
              </motion.span>
            );
          })}
        </span>
      ))}
    </h1>
  );
}

/** Landing hero: headline, call to action, trust row and the self-playing product shot. */
export default function Hero({ version, lang }: { version: string | null; lang: Lang }) {
  const d = dict(lang).hero;
  const trust = [ShieldCheck, Server, Lock, Code2, Smartphone, Star];
  return (
    <header className="hero" id="top">
      <div className="hero-bg"><div className="hero-grid" /><div className="hero-orb" /></div>
      <div className="wrap">
        <motion.a className="announce" href={localUrl(lang, '/roadmap/')} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
          <b>{dict(lang).beta.chip}{version ? ` ${version}` : ''}</b> {d.announce} <ArrowRight className="rtl-flip" />
        </motion.a>
        <Headline phrases={d.headline} />
        <motion.p className="lead" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.55, ease: EASE }}>
          {d.lead}
        </motion.p>
        <motion.div className="cta" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.7, ease: EASE }}>
          <a className="btn primary" href={localUrl(lang, '/docs/getting-started/quick-start/')}>{d.start} <ArrowRight className="rtl-flip" /></a>
          <a className="btn" href={localUrl(lang, '/download/')}><Download />{d.download}</a>
          <a className="btn" href={REPO_URL} target="_blank" rel="noopener noreferrer"><GithubIcon />{d.star}</a>
        </motion.div>
        <motion.div className="trust" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.95 }}>
          {d.trust.map((label, i) => { const Icon = trust[i]; return <span key={label}><Icon />{label}</span>; })}
        </motion.div>
        <CoveDemo lang={lang} />
      </div>
    </header>
  );
}
