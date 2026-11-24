import { Avatar, Bar, Bubble, Phone, Row, Stage, Thread, Window } from '../stageshow/kit';
import '../stageshow/kit/stageshow.css';
import './cove-stage.css';
import './cove-scenes.css';
import { useSiteTheme } from './useSiteTheme';
import { dict, type Lang } from '@/i18n';

/**
 * Stageshow scene for the Platforms card: one conversation on a desktop window and on a phone at once.
 * A still, so it costs nothing while the visitor reads.
 */
export default function CovePlatforms({ lang }: { lang: Lang }) {
  const d = dict(lang).hero;
  const theme = useSiteTheme();
  return (
    <div className="cs-wrap" dir="ltr">
      <Stage width={480} height={250} fill theme={theme} className="cove-ss cs-plat">
        {() => (
          <>
            <Window url="chat.example.org" className="cs-plat__window" sidebar={
              <div className="cs-plat__side">
                {['design-team', 'Sara', 'general'].map((n, i) => (
                  <Row key={n} lead={<Avatar name={n} size={22} />} title={n} selected={i === 0} pad={6} />
                ))}
              </div>
            } sidebarWidth={140}>
              <div className="cs-plat__chat">
                <Bar w={150} h={6} tone={3} />
                <Bar w={110} h={6} tone={2} />
                <Bar w={170} h={6} tone={3} />
              </div>
            </Window>
            <Phone width={160} frame="pro" dark wallpaper="var(--card)" className="cs-plat__phone">
              <div className="cs-plat__phone-body">
                <Thread app="imessage">
                  <Bubble from="them">{d.chat[1]}</Bubble>
                  <Bubble from="me">{d.ui.typed}</Bubble>
                </Thread>
              </div>
            </Phone>
          </>
        )}
      </Stage>
    </div>
  );
}
