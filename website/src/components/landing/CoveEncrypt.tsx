import { Lock } from 'lucide-react';
import { Badge, Card, Connector, Stage, Swap, Text, type Act } from '../stageshow/kit';
import '../stageshow/kit/stageshow.css';
import './cove-stage.css';
import './cove-scenes.css';
import { useSiteTheme } from './useSiteTheme';
import { dict, type Lang } from '@/i18n';

interface S { sealed: boolean; chips: number }
const initial: S = { sealed: false, chips: 0 };
const poster: S = { sealed: true, chips: 4 };

const CIPHER = 'aes256gcm:9f3a41c7e0b25d18c1';

async function script(a: Act<S>) {
  await a.wait(1000);
  await a.set({ sealed: true });
  await a.wait(900);
  for (let n = 1; n <= 4; n++) {
    await a.set({ chips: n });
    await a.wait(260);
  }
  await a.wait(3400);
}

/**
 * Stageshow scene for the "Encrypted by default" card: the sentence is sealed with the channel key, the
 * server only ever holds the sealed bytes, and the layers of key protection appear underneath.
 */
export default function CoveEncrypt({ lang }: { lang: Lang }) {
  const d = dict(lang);
  const f = d.features.enc;
  const theme = useSiteTheme();
  return (
    <div className="cs-wrap" dir="ltr">
      <Stage width={480} height={190} initial={initial} poster={poster} script={script} play="loop" fill theme={theme} className="cove-ss cs-enc">
        {(s) => (
          <>
            <Card className="cs-enc__card" style={{ left: 16, top: 14, width: 170, height: 84 }}>
              <Text className="cs-enc__label">{d.how.nodes[0].title}</Text>
              <Text className="cs-enc__plain" wrap>{f.sample}</Text>
            </Card>
            <span className="cs-enc__key" data-on={s.sealed || undefined}><Lock size={18} /></span>
            <Card className="cs-enc__card" data-cipher style={{ left: 298, top: 14, width: 166, height: 84 }}>
              <Text className="cs-enc__label">{d.how.nodes[1].title}</Text>
              <div className="cs-enc__cipher"><Swap id={s.sealed ? 'sealed' : 'wait'}>{s.sealed ? CIPHER : '· · ·'}</Swap></div>
            </Card>
            <div className="cs-enc__chips">
              {f.chips.map((c, i) => (
                <span key={c} className="cs-enc__chip" data-on={s.chips > i || undefined}>
                  <Badge tone={i === 0 ? 'accent' : 'neutral'}>{c}</Badge>
                </span>
              ))}
            </div>
            <Connector from={{ x: 186, y: 56 }} to={{ x: 222, y: 56 }} route="straight" arrow show={s.sealed} />
            <Connector from={{ x: 262, y: 56 }} to={{ x: 298, y: 56 }} route="straight" arrow show={s.sealed} />
          </>
        )}
      </Stage>
    </div>
  );
}
