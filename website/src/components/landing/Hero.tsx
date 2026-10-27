import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { ArrowRight, ChevronLeft, Code2, Download, Hash, LayoutList, Lock, MessageCircle, Mic, Phone, PhoneCall, Plus, Search, Send, Server, Settings, ShieldCheck, SlidersHorizontal, Smartphone, Smile, Star, Users, Video, Volume2 } from 'lucide-react';
import { BorderBeam, GithubIcon } from './primitives';
import ScrambleText from './ScrambleText';
import { REPO_URL } from '@/lib/site';
import { dict, localUrl, type Lang } from '@/i18n';

const EASE = [0.22, 1, 0.36, 1] as const;

/** Sidebar conversations, shaped like the real app: letter avatars, last-message preview, unread pill, presence dot on DMs. */
interface Convo { name: string; sub: string; color: string; unread?: number; active?: boolean; presence?: 'online' | 'idle' }
const CONVOS: Convo[] = [
  { name: 'launch-crew', sub: 'Sara: ready to ship', color: '#ef5350', unread: 2 },
  { name: 'design-team', sub: 'Jo: Whisper for the keys?', color: '#58c48a', active: true },
  { name: 'Sara', sub: 'Online', color: '#6b8fd6', presence: 'online' },
  { name: 'Amir', sub: 'Idle', color: '#58a97b', presence: 'idle' },
  { name: 'general', sub: 'You: see you at 6', color: '#f5c265' },
];

interface Line {
  who: string;
  initials: string;
  color: string;
  time: string;
  text: string;
  encrypted?: boolean;
}

const PEOPLE = [
  { who: 'Sara', initials: 'SA', color: '#6b8fd6', time: '10:02', encrypted: true },
  { who: 'Amir', initials: 'AM', color: '#58a97b', time: '10:03', encrypted: false },
  { who: 'Jo', initials: 'JO', color: 'var(--primary)', time: '10:03', encrypted: false },
];

/** Headline revealed word by word. */
function Headline({ phrases }: { phrases: string[] }) {
  const reduce = useReducedMotion();
  const words = phrases.flatMap((p, pi) => p.split(' ').map((w) => ({ w, grad: pi === phrases.length - 1 })));
  return (
    <h1 aria-label={phrases.join(' ')}>
      {words.map((x, i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          className={x.grad ? 'grad' : undefined}
          style={{ display: 'inline-block', marginInlineEnd: '0.24em' }}
          initial={reduce ? false : { opacity: 0, y: 28, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, delay: 0.1 + i * 0.07, ease: EASE }}
        >
          {x.w}
        </motion.span>
      ))}
    </h1>
  );
}

/** App window whose conversation plays itself: messages arrive as ciphertext and resolve. */
function ProductShot({ lang }: { lang: Lang }) {
  const d = dict(lang).hero;
  const LINES: Line[] = PEOPLE.map((p, i) => ({ ...p, text: d.chat[i] }));
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduce = useReducedMotion();
  const [count, setCount] = useState(reduce ? LINES.length : 0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!inView || reduce) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    LINES.forEach((_, i) => {
      timers.push(setTimeout(() => setTyping(true), 700 + i * 1900));
      timers.push(setTimeout(() => { setTyping(false); setCount(i + 1); }, 1350 + i * 1900));
    });
    return () => timers.forEach(clearTimeout);
  }, [inView, reduce]);

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const yA = useTransform(scrollYProgress, [0, 1], [30, -50]);
  const yB = useTransform(scrollYProgress, [0, 1], [-10, 50]);

  return (
    <div className="shot-wrap" ref={ref}>
      <motion.div
        className="shot beam-host"
        initial={reduce ? false : { opacity: 0, y: 60, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 1.1, delay: 0.5, ease: EASE }}
      >
        <BorderBeam size={220} duration={10} />
        <div className="app">
          <div className="rail">
            <i className="on"><LayoutList /></i>
            <i><MessageCircle /></i>
            <i><Hash /></i>
          </div>
          <div className="side">
            <div className="side-head"><b>Cove</b><small>0.9.0</small><ChevronLeft /></div>
            <div className="side-search"><Search /><span>{d.ui.search}</span><kbd>Ctrl K</kbd><Plus /></div>
            {CONVOS.map((c) => (
              <div key={c.name} className={`convo ${c.active ? 'on' : ''}`}>
                <div className="av" style={{ background: c.color }}>{c.name[0].toUpperCase()}{c.presence && <span className={`pd ${c.presence}`} />}</div>
                <div className="cm"><b>{c.name}</b><small>{c.sub}</small></div>
                {c.unread ? <span className="unread">{c.unread}</span> : null}
              </div>
            ))}
            <div className="side-user"><div className="av" style={{ background: 'var(--primary)' }}>A</div><div className="cm"><b>alice</b><small>Online</small></div><Settings /></div>
          </div>
          <div className="main">
            <div className="main-head">
              <div className="av" style={{ background: '#58c48a' }}>D</div>
              <div className="cm"><b>design-team</b><small>{d.ui.channelDesc}</small></div>
              <span className="sp" /><Search /><SlidersHorizontal /><Phone className="calling" />
            </div>
            <div className="chat">
              <AnimatePresence initial={false}>
                {LINES.slice(0, count).map((l) => (
                  <motion.div
                    key={l.who}
                    className="msg"
                    layout
                    initial={{ opacity: 0, y: 16, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  >
                    <div className="av" style={{ background: l.color }}>{l.initials}</div>
                    <div>
                      <b>{l.who}</b><small>{l.time}</small>
                      <p>{l.encrypted ? <ScrambleText text={l.text} duration={1100} /> : l.text}</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <AnimatePresence>
                {typing && (
                  <motion.div className="typing" layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.2 }}>
                    <s /><s /><s />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="composer"><Plus /><span>{d.ui.composer}</span><Mic /><Video /><Smile /><Send className="rtl-flip" /></div>
          </div>
          <div className="members">
            <Users />
            <div className="av" style={{ background: '#6b8fd6' }}>S<span className="pd online" /></div>
            <div className="av" style={{ background: '#58a97b' }}>A<span className="pd online" /></div>
            <div className="av" style={{ background: 'var(--primary)' }}>J<span className="pd idle" /></div>
          </div>
        </div>
      </motion.div>

      <motion.div className="float-card float-call" style={{ y: reduce ? 0 : yA }} initial={reduce ? false : { opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, delay: 1.6, ease: EASE }}>
        <div className="ic"><PhoneCall size={18} /></div>
        <div><b>{d.callTitle}</b><small>{d.callSub}</small></div>
        <Volume2 size={16} style={{ color: 'var(--success)' }} />
      </motion.div>
      <motion.div className="float-card float-lock" style={{ y: reduce ? 0 : yB }} initial={reduce ? false : { opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, delay: 1.9, ease: EASE }}>
        <div className="ic"><Lock size={18} /></div>
        <div><b>{d.lockTitle}</b><small>{d.lockSub}</small></div>
      </motion.div>
    </div>
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
          <b>{version ?? d.badgeFallback}</b> {d.announce} <ArrowRight className="rtl-flip" />
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
        <ProductShot lang={lang} />
      </div>
    </header>
  );
}
