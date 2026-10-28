import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { Crown, EyeOff, Globe, KeyRound, Languages, Lock, Monitor, PhoneCall, ShieldCheck, Smartphone, Sparkles, TerminalSquare, UserCog, Users } from 'lucide-react';
import { BlurFade, SpotlightCard } from './primitives';
import ScrambleText from './ScrambleText';
import { dict, type Dict, type Lang } from '@/i18n';

type F = Dict['features'];

/** Returns [ref, inView] and keeps an animation idle until the card is on screen. */
function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { margin: '-10% 0px' });
  return [ref, inView] as const;
}

/** Runs `tick` every `ms` while `active`; honors reduced motion. */
function useCycle(active: boolean, count: number, ms: number, start = 0) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(start);
  useEffect(() => {
    if (!active || reduce) return;
    const t = setInterval(() => setI((n) => (n + 1) % count), ms);
    return () => clearInterval(t);
  }, [active, reduce, count, ms]);
  return i;
}

type Tone = 'primary' | 'violet' | 'green' | 'blue' | 'amber' | 'pink' | 'teal';
type Pattern = 'dots' | 'rings' | 'grid' | 'lines' | 'checker' | 'lattice' | 'bars';

/** Each card has its own hover color (tone) and a faint background texture (pattern), styled in responsive.css. */
function Card({ icon, title, text, className = '', delay = 0, tone, pattern, children }: { icon: ReactNode; title: string; text: string; className?: string; delay?: number; tone: Tone; pattern: Pattern; children: ReactNode }) {
  return (
    <BlurFade delay={delay} className={className}>
      <SpotlightCard className={`tone-${tone} pat-${pattern}`}>
        <div className="ico">{icon}</div>
        <h3>{title}</h3>
        <p>{text}</p>
        <div className="stage">{children}</div>
      </SpotlightCard>
    </BlurFade>
  );
}

/** Sender text -> key -> receiver text resolving out of noise, on a loop. */
function EncryptionViz({ f }: { f: F['enc'] }) {
  const [ref, inView] = useVisible<HTMLDivElement>();
  return (
    <div ref={ref}>
      <div className="cipher-row">
        <div className="bubble">{f.sample}</div>
        <motion.div className="keychip" animate={inView ? { boxShadow: ['0 0 0 0 rgba(217,130,106,.5)', '0 0 0 10px rgba(217,130,106,0)'] } : undefined} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeOut' }}>
          <KeyRound />
        </motion.div>
        <div className="bubble cipher">
          <ScrambleText text={f.sample} play={inView} loop duration={1400} holdMs={2200} />
        </div>
      </div>
      <div className="meta-row">
        {f.chips.map((c, i) => <span key={c} className={`chip ${i === 0 ? 'p' : ''}`}>{c}</span>)}
      </div>
    </div>
  );
}

/** A message that burns down on a countdown ring and is never written anywhere. */
function WhisperViz({ f }: { f: F['whisper'] }) {
  return (
    <div className="whisper-msg">
      <svg className="ring" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r="11" stroke="var(--border)" />
        <circle className="whisper-ring" cx="14" cy="14" r="11" stroke="var(--primary)" strokeLinecap="round" strokeDasharray="69.1" transform="rotate(-90 14 14)" />
      </svg>
      <span className="whisper-text">{f.sample}</span>
      <span className="whisper-gone"><EyeOff size={14} /> {f.gone}</span>
    </div>
  );
}

const CALL_PEOPLE = [
  { n: 'Sara', i: 'SA', c: '#6b8fd6' },
  { n: 'Amir', i: 'AM', c: '#58a97b' },
  { n: 'Jo', i: 'JO', c: 'var(--primary)' },
  { n: 'Lea', i: 'LE', c: '#b07fd0' },
];

/** Call grid: the "speaking" ring moves between participants beside a shared screen. */
function CallViz({ f }: { f: F['calls'] }) {
  const [ref, inView] = useVisible<HTMLDivElement>();
  const active = useCycle(inView, CALL_PEOPLE.length, 1500);
  return (
    <div className="call-grid" ref={ref}>
      <div className="tile share">
        <div className="share-lines">
          {[80, 55, 70, 40, 62].map((w, i) => (
            <motion.i key={i} initial={{ width: 0 }} animate={inView ? { width: `${w}%` } : { width: 0 }} transition={{ duration: 0.9, delay: i * 0.12 }} />
          ))}
        </div>
        <span className="name">{f.sharing}</span>
      </div>
      {CALL_PEOPLE.map((p, i) => (
        <div key={p.n} className={`tile ${active === i ? 'speaking' : ''}`}>
          <div className="av" style={{ background: p.c }}>{p.i}</div><span className="name">{p.n}</span>
        </div>
      ))}
    </div>
  );
}

/** Server boot log lines streaming in once. */
function BootViz({ f }: { f: F['binary'] }) {
  const [ref, inView] = useVisible<HTMLDivElement>();
  return (
    <div className="boot" ref={ref}>
      <div><span className="hl">$</span> ./cove-server</div>
      {f.boot.map((line, i) => (
        <motion.div key={line} initial={{ opacity: 0, x: -8 }} animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: -8 }} transition={{ delay: 0.5 + i * 0.45, duration: 0.4 }}>
          {i > 0 && i < f.boot.length - 1 ? <span className="ok">ok </span> : null}
          {i === f.boot.length - 1 ? <span className="hl">{line}</span> : line}
        </motion.div>
      ))}
    </div>
  );
}

const ROLE_ICONS = [Crown, UserCog, Users];

/** Role rows whose permission toggle flips in sequence. */
function AdminViz({ f }: { f: F['admin'] }) {
  const [ref, inView] = useVisible<HTMLDivElement>();
  const on = useCycle(inView, 3, 1800, 1);
  return (
    <div className="roles" ref={ref}>
      {f.roles.map((r, i) => {
        const Icon = ROLE_ICONS[i];
        return (
          <div className="role" key={r.name}>
            <Icon />
            <span className="grow">{r.name} <small>{r.sub}</small></span>
            <span className={`toggle ${i === on || i === 0 ? 'on' : ''}`}><i /></span>
          </div>
        );
      })}
    </div>
  );
}

const HELLOS = [
  { t: 'Hello', l: 'EN', dir: 'ltr' },
  { t: 'سلام', l: 'FA', dir: 'rtl' },
  { t: 'مرحبا', l: 'AR', dir: 'rtl' },
] as const;

/** Greeting that cycles through the shipped languages. */
function I18nViz() {
  const [ref, inView] = useVisible<HTMLDivElement>();
  const h = HELLOS[useCycle(inView, HELLOS.length, 2000)];
  return (
    <div ref={ref} className="hello" dir="ltr">
      <AnimatePresence mode="wait">
        <motion.span key={h.t} dir={h.dir} initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }} transition={{ duration: 0.35 }}>
          {h.t}
        </motion.span>
      </AnimatePresence>
      <span className="lang">{h.l}</span>
    </div>
  );
}

const DEVICE_ICONS = [Globe, Monitor, Smartphone];

/** Three clients, highlighted in turn to read as one product on many screens. */
function PlatformViz({ f }: { f: F['platforms'] }) {
  const [ref, inView] = useVisible<HTMLDivElement>();
  const i = useCycle(inView, 3, 1400);
  return (
    <div className="devices" ref={ref}>
      {f.devices.map((name, n) => {
        const Icon = DEVICE_ICONS[n];
        return (
          <motion.div key={name} className="device" animate={{ borderColor: n === i ? 'var(--primary)' : 'var(--border)', y: n === i ? -4 : 0 }} transition={{ duration: 0.4 }}>
            <Icon />{name}
          </motion.div>
        );
      })}
    </div>
  );
}

/** Feature bento: seven cards, each with a small animation that demonstrates its claim. */
export default function Features({ lang }: { lang: Lang }) {
  const f = dict(lang).features;
  return (
    <div className="bento">
      <Card className="w4" tone="primary" pattern="dots" icon={<Lock />} title={f.enc.title} text={f.enc.text}><EncryptionViz f={f.enc} /></Card>
      <Card delay={0.06} tone="violet" pattern="rings" icon={<EyeOff />} title={f.whisper.title} text={f.whisper.text}><WhisperViz f={f.whisper} /></Card>
      <Card className="w3" tone="green" pattern="grid" icon={<PhoneCall />} title={f.calls.title} text={f.calls.text}><CallViz f={f.calls} /></Card>
      <Card className="w3" delay={0.06} tone="blue" pattern="lines" icon={<TerminalSquare />} title={f.binary.title} text={f.binary.text}><BootViz f={f.binary} /></Card>
      <Card tone="amber" pattern="checker" icon={<ShieldCheck />} title={f.admin.title} text={f.admin.text}><AdminViz f={f.admin} /></Card>
      <Card delay={0.06} tone="pink" pattern="lattice" icon={<Languages />} title={f.i18n.title} text={f.i18n.text}><I18nViz /></Card>
      <Card delay={0.12} tone="teal" pattern="bars" icon={<Sparkles />} title={f.platforms.title} text={f.platforms.text}><PlatformViz f={f.platforms} /></Card>
    </div>
  );
}
