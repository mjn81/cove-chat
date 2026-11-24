import { Avatar, Badge, Bar, Stage, Text, Window, type Act } from '../stageshow/kit';
import '../stageshow/kit/stageshow.css';
import './cove-stage.css';
import './cove-scenes.css';
import { useSiteTheme } from './useSiteTheme';
import { dict, type Lang } from '@/i18n';

/** Who is speaking, as an index into PEOPLE. The ring moves on its own; nothing is clicked. */
interface S { speaker: number }
const initial: S = { speaker: 0 };
const poster: S = { speaker: 1 };
const PEOPLE = ['Sara', 'Amir', 'Jo'] as const;

async function script(a: Act<S>) {
  for (const speaker of [1, 2, 0]) {
    await a.wait(1500);
    await a.set({ speaker });
  }
  await a.wait(1500);
}

/**
 * Stageshow scene for the Calls card: a call window with a shared screen beside the participants, and the
 * speaking ring moving between them.
 */
export default function CoveCall({ lang }: { lang: Lang }) {
  const d = dict(lang);
  const theme = useSiteTheme();
  return (
    <div className="cs-wrap" dir="ltr">
      <Stage width={480} height={250} initial={initial} poster={poster} script={script} play="loop" fill theme={theme} className="cove-ss cs-call">
        {(s) => (
          <Window title={d.hero.callTitle} className="cs-call__window">
            <div className="cs-call__body">
              <div className="cs-call__share">
                <Badge tone="success" dot>{d.features.calls.sharing}</Badge>
                <div className="cs-call__lines">
                  {[78, 54, 66, 38, 60].map((w, i) => <Bar key={i} w={`${w}%`} h={6} tone={i === 1 ? 4 : 2} />)}
                </div>
              </div>
              <div className="cs-call__people">
                {PEOPLE.map((name, i) => (
                  <div key={name} className="cs-call__tile" data-speaking={s.speaker === i || undefined}>
                    <Avatar name={name} size={34} />
                    <Text className="cs-call__name">{name}</Text>
                  </div>
                ))}
              </div>
            </div>
          </Window>
        )}
      </Stage>
    </div>
  );
}
