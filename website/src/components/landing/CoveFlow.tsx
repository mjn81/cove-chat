import { useMemo, useRef } from 'react';
import { Laptop, Lock, LockOpen, Server, Users, type LucideIcon } from 'lucide-react';
import { Badge, Card, Connector, Stage, Swap, Text, type Act } from '../stageshow/kit';
import '../stageshow/kit/stageshow.css';
import './cove-stage.css';
import './cove-scenes.css';
import { useSiteTheme } from './useSiteTheme';
import { dict, type Lang } from '@/i18n';

/** Where the message is in its journey. Each flag is one thing a viewer can see change. */
interface S {
  step: 0 | 1 | 2;
  sealed: boolean;
  line1: boolean;
  atServer: boolean;
  line2: boolean;
  atMember: boolean;
  opened: boolean;
}

const initial: S = { step: 0, sealed: false, line1: false, atServer: false, line2: false, atMember: false, opened: false };
/** Reduced motion and thumbnails show the finished journey. */
const poster: S = { step: 2, sealed: true, line1: true, atServer: true, line2: true, atMember: true, opened: true };

const PLAIN = 'Meet at 6?';
const CIPHER = '9f3a 41c7 e0b2 5d18';

/** Card boxes and connector endpoints per layout, in stage pixels. Wide runs across, compact stacks down. */
const GEO = {
  wide: {
    size: { w: 980, h: 300 },
    cards: [{ x: 30, y: 46 }, { x: 380, y: 46 }, { x: 730, y: 46 }],
    card: { w: 220, h: 200 },
    lines: [{ from: { x: 258, y: 146 }, to: { x: 372, y: 146 } }, { from: { x: 608, y: 146 }, to: { x: 722, y: 146 } }],
  },
  compact: {
    size: { w: 400, h: 560 },
    cards: [{ x: 40, y: 14 }, { x: 40, y: 200 }, { x: 40, y: 386 }],
    card: { w: 320, h: 150 },
    lines: [{ from: { x: 200, y: 168 }, to: { x: 200, y: 194 } }, { from: { x: 200, y: 354 }, to: { x: 200, y: 380 } }],
  },
} as const;

const ICONS: LucideIcon[] = [Laptop, Server, Users];

/**
 * Stageshow scene for "How it works". The same message is shown in the three places it lives: sealed on
 * the client, as opaque bytes on the server, and readable again only for members. `onStep` lets the step
 * cards under the diagram follow along.
 */
export default function CoveFlow({ lang, onStep }: { lang: Lang; onStep: (step: number) => void }) {
  const d = dict(lang);
  const theme = useSiteTheme();

  // The parent re-renders on every onStep call. A new script function would restart the scene, so the
  // script is created once and reaches the latest callback through a ref.
  const report = useRef(onStep);
  report.current = onStep;
  const script = useMemo(() => async (a: Act<S>) => {
    report.current(0);
    await a.wait(1100);
    await a.set({ sealed: true });
    await a.wait(1500);
    report.current(1);
    await a.set({ step: 1, line1: true });
    await a.wait(900);
    await a.set({ atServer: true });
    await a.wait(1700);
    report.current(2);
    await a.set({ step: 2, line2: true });
    await a.wait(900);
    await a.set({ atMember: true });
    await a.wait(800);
    await a.set({ opened: true });
    await a.wait(3200);
  }, []);

  return (
    <div className="cs-wrap" dir="ltr">
      <Stage
        width={GEO.wide.size.w}
        height={GEO.wide.size.h}
        compact={{ below: 720, width: GEO.compact.size.w, height: GEO.compact.size.h }}
        initial={initial}
        poster={poster}
        script={script}
        play="loop"
        theme={theme}
        className="cove-ss cs-flow"
      >
        {(s, _rect, layout) => {
          const g = GEO[layout];
          const memberText = s.opened ? PLAIN : CIPHER;
          const clientText = s.sealed ? CIPHER : PLAIN;
          const bodies = [
            { text: clientText, id: s.sealed ? 'c' : 'p', chip: s.sealed, mono: s.sealed, empty: false },
            { text: CIPHER, id: 'srv', chip: false, mono: true, empty: !s.atServer },
            { text: memberText, id: s.opened ? 'p' : 'c', chip: !s.opened && s.atMember, mono: !s.opened, empty: !s.atMember },
          ];
          return (
            <>
              {g.cards.map((pos, i) => {
                const node = d.how.nodes[i];
                const Icon = ICONS[i];
                const b = bodies[i];
                return (
                  <Card key={i} lift className="cs-flow__card" data-active={s.step === i || undefined} style={{ left: pos.x, top: pos.y, width: g.card.w, height: g.card.h }}>
                    <div className="cs-flow__head">
                      <span className="cs-flow__icon"><Icon size={18} /></span>
                      <span className="cs-flow__who">
                        <Text className="cs-flow__title">{node.title}</Text>
                        <Text className="cs-flow__sub">{node.sub}</Text>
                      </span>
                    </div>
                    <div className="cs-flow__msg" data-empty={b.empty || undefined} data-mono={b.mono || undefined}>
                      <Swap id={b.id + (b.empty ? 'e' : '')}>{b.empty ? '· · ·' : b.text}</Swap>
                    </div>
                    <div className="cs-flow__foot">
                      {i === 0 && <Badge tone={s.sealed ? 'accent' : 'neutral'} icon={s.sealed ? <Lock size={12} /> : undefined}>AES-256-GCM</Badge>}
                      {i === 1 && <Badge tone={s.atServer ? 'accent' : 'neutral'} icon={<Lock size={12} />}>KEK</Badge>}
                      {i === 2 && <Badge tone={s.opened ? 'success' : 'neutral'} icon={s.opened ? <LockOpen size={12} /> : <Lock size={12} />}>{s.opened ? 'OK' : 'AES-256-GCM'}</Badge>}
                    </div>
                  </Card>
                );
              })}
              <Connector from={g.lines[0].from} to={g.lines[0].to} route="straight" arrow show={s.line1} label={1} />
              <Connector from={g.lines[1].from} to={g.lines[1].to} route="straight" arrow show={s.line2} label={2} />
            </>
          );
        }}
      </Stage>
    </div>
  );
}
