import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

const GLYPHS = '0123456789abcdef';

function scramble(text: string, resolved: number): string {
  return text
    .split('')
    .map((ch, i) => (i < resolved || ch === ' ' ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
    .join('');
}

/**
 * Resolves `text` out of random hex, left to right, which is how a ciphertext becomes a message.
 * Runs when `play` flips to true; with `loop` it restarts from ciphertext after `holdMs`.
 */
export default function ScrambleText({
  text,
  play = true,
  duration = 900,
  loop = false,
  holdMs = 2600,
  className,
}: {
  text: string;
  play?: boolean;
  duration?: number;
  loop?: boolean;
  holdMs?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [out, setOut] = useState(() => (reduce ? text : scramble(text, 0)));
  const raf = useRef(0);

  useEffect(() => {
    if (reduce) {
      setOut(text);
      return;
    }
    if (!play) {
      setOut(scramble(text, 0));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        setOut(p >= 1 ? text : scramble(text, Math.floor(p * text.length)));
        if (p < 1) raf.current = requestAnimationFrame(tick);
        else if (loop) timer = setTimeout(run, holdMs);
      };
      raf.current = requestAnimationFrame(tick);
    };
    run();
    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(timer);
    };
  }, [text, play, duration, loop, holdMs, reduce]);

  return <span className={className}>{out}</span>;
}
