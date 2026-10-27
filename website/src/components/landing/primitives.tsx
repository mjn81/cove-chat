import { useEffect, useRef, type CSSProperties, type ReactNode, type PointerEvent } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion } from 'motion/react';

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Scroll-triggered entrance: fades up out of a soft blur. Plays once.
 * @param props.delay Seconds to wait before starting (use for stagger).
 */
export function BlurFade({
  children,
  delay = 0,
  className,
  style,
  y = 14,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={style}
      initial={reduce ? false : { opacity: 0, y, filter: 'blur(4px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '0px 0px -40px 0px' }}
      transition={{ duration: 0.5, delay: Math.min(delay, 0.2), ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Card whose border and fill glow follow the cursor.
 * Visuals live in `.spot` (landing.css); this only feeds `--mx/--my`.
 */
export function SpotlightCard({
  children,
  className = '',
  as: Tag = 'div',
  href,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'a';
  href?: string;
}) {
  const ref = useRef<HTMLDivElement & HTMLAnchorElement>(null);
  const onMove = (e: PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  const props = { ref, className: `spot ${className}`, onPointerMove: onMove };
  return Tag === 'a' ? (
    <a {...props} href={href}>
      <div className="spot-in">{children}</div>
    </a>
  ) : (
    <div {...props}>
      <div className="spot-in">{children}</div>
    </div>
  );
}

/** Light arc that orbits the parent's border. Parent needs `position: relative` and `--radius`. */
export function BorderBeam({ size = 160, duration = 9 }: { size?: number; duration?: number }) {
  return <span className="border-beam" style={{ ['--beam-size' as string]: `${size}px`, ['--beam-dur' as string]: `${duration}s` }} />;
}

/** Counts up to `value` once visible, with an ease-out curve. */
export function NumberTicker({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 1.6, ease: EASE });
    return () => controls.stop();
  }, [inView, value, reduce, mv]);

  useEffect(() => mv.on('change', (v) => {
    if (ref.current) ref.current.textContent = Math.round(v).toLocaleString('en-US');
  }), [mv]);

  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}

/** GitHub mark (lucide dropped brand icons). */
export function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
