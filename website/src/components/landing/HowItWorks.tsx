import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { Info, Laptop, Lock, Server, Users } from 'lucide-react';
import { BlurFade } from './primitives';
import { dict, type Lang } from '@/i18n';

const STEP_MS = 3200;

const PACKETS = ['aes256gcm:9f3a...c1', 'aes256gcm:9f3a...c1', 'Meet at 6?'] as const;

interface Pt { x: number; y: number }

/** Quadratic curve between two points, bowed upward so the two beams read as distinct paths. */
function curve(a: Pt, b: Pt, bow: number): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - bow;
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

/**
 * Three-step diagram (client, server, members). One step is active at a time; the active beam
 * carries a packet between nodes and the matching step card fills a progress bar. Steps are also
 * clickable. Beam geometry is measured from the real node positions so it survives resizing.
 */
export default function HowItWorks({ lang }: { lang: Lang }) {
  const d = dict(lang).how;
  const stage = useRef<HTMLDivElement>(null);
  const nodes = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const inView = useInView(stage, { margin: '-15% 0px' });
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [geo, setGeo] = useState<{ w: number; h: number; pts: Pt[] } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const s = stage.current;
      if (!s) return;
      const sr = s.getBoundingClientRect();
      const pts = nodes.map((n) => {
        const r = n.current!.getBoundingClientRect();
        return { x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2, hw: r.width / 2 } as Pt & { hw: number };
      });
      setGeo({ w: sr.width, h: sr.height, pts });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (stage.current) ro.observe(stage.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || reduce) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % 3), STEP_MS);
    return () => clearTimeout(t);
  }, [inView, reduce, step]);

  // Step 0 lives inside node 0, step 1 travels node0 -> node1, step 2 travels node1 -> node2.
  const from = step === 2 ? 1 : 0;
  const to = step === 2 ? 2 : 1;
  const p = geo?.pts as (Pt & { hw: number })[] | undefined;
  const a = p && { x: p[from].x + p[from].hw, y: p[from].y };
  const b = p && { x: p[to].x - p[to].hw, y: p[to].y };

  return (
    <div className="hiw">
      <BlurFade>
        <div className="hiw-stage" ref={stage}>
          {p && geo && (
            <svg className="hiw-svg" viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true">
              <defs>
                <linearGradient id="beam-g" gradientUnits="userSpaceOnUse" x1={a!.x} x2={b!.x} y1="0" y2="0">
                  <stop offset="0" stopColor="var(--primary)" stopOpacity="0" />
                  <stop offset="0.5" stopColor="var(--primary)" />
                  <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 1].map((i) => {
                const s = { x: p[i].x + p[i].hw, y: p[i].y };
                const e = { x: p[i + 1].x - p[i + 1].hw, y: p[i + 1].y };
                const active = (step === 2 ? 1 : 0) === i && step !== 0;
                return (
                  <g key={i}>
                    <path d={curve(s, e, 0)} stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4 6" fill="none" />
                    <motion.path d={curve(s, e, 0)} stroke="url(#beam-g)" strokeWidth="2.5" fill="none" strokeLinecap="round" initial={false} animate={{ opacity: active ? 1 : 0, pathLength: active ? 1 : 0 }} transition={{ duration: STEP_MS / 1000 * 0.7, ease: [0.22, 1, 0.36, 1] }} />
                  </g>
                );
              })}
            </svg>
          )}

          <div ref={nodes[0]} className={`hiw-node ${step === 0 ? 'active' : ''}`}>
            <div className="ni"><Laptop /></div><b>{d.nodes[0].title}</b><small>{d.nodes[0].sub}</small>
          </div>
          <div ref={nodes[1]} className={`hiw-node ${step === 1 ? 'active' : ''}`}>
            <div className="ni"><Server /></div><b>{d.nodes[1].title}</b><small>{d.nodes[1].sub}</small>
          </div>
          <div ref={nodes[2]} className={`hiw-node ${step === 2 ? 'active' : ''}`}>
            <div className="ni"><Users /></div><b>{d.nodes[2].title}</b><small>{d.nodes[2].sub}</small>
          </div>

          <AnimatePresence>
            {a && b && step > 0 && (
              <motion.div
                key={step}
                className="hiw-packet"
                initial={{ x: a.x, y: a.y - 14, opacity: 0, scale: 0.8 }}
                animate={{ x: [a.x, (a.x + b.x) / 2 - 40, b.x - 90], y: a.y - 14, opacity: [0, 1, 1, 0], scale: 1 }}
                transition={{ duration: STEP_MS / 1000 * 0.85, ease: 'easeInOut', times: [0, 0.2, 0.8, 1] }}
              >
                {step === 1 ? <Lock /> : null}
                {PACKETS[step]}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </BlurFade>

      <div className="hiw-steps">
        {d.steps.map((s, i) => (
          <button key={s.title} type="button" className={`hiw-step ${step === i ? 'active' : ''}`} onClick={() => setStep(i)}>
            <span className="num">0{i + 1}</span>
            <b>{s.title}</b>
            <p>{s.text}</p>
            {step === i && !reduce && (
              <motion.span key={`${step}-${inView}`} className="prog" initial={{ scaleX: 0 }} animate={{ scaleX: inView ? 1 : 0 }} transition={{ duration: STEP_MS / 1000, ease: 'linear' }} />
            )}
          </button>
        ))}
      </div>

      <BlurFade delay={0.1}>
        <div className="note">
          <Info />
          <div><b>{d.noteStrong}</b> {d.note}</div>
        </div>
      </BlurFade>
    </div>
  );
}
