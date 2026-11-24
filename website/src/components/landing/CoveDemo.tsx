import { useEffect, useState } from 'react';
import { Phone as PhoneIcon } from 'lucide-react';
import { Avatar, Badge, Bar, Button, Facepile, Field, Icon, LockScreen, Notification, Phone, Row, Stamp, Stage, Text, Thread, Bubble, Window, type Act } from '../stageshow/kit';
import '../stageshow/kit/stageshow.css';
import './cove-demo.css';
import { dict, type Lang } from '@/i18n';

/**
 * Built with the Stageshow kit (src/components/stageshow). A scripted illustration of Cove, not a live app:
 * a message is typed and sent into #design-team, then the channel's call starts. The phone beside the window
 * says the one thing the product promises, that the text was encrypted before it left the client.
 */

interface S {
  draft: string;
  focus: boolean;
  sent: boolean;
  call: boolean;
}

const initial: S = { draft: '', focus: false, sent: false, call: false };
/** What reduced motion and thumbnails show: the whole story, result on screen. */
const poster: S = { draft: '', focus: false, sent: true, call: true };

/** The kit's default lock screen is a cool blue-lilac; this one is Cove's terracotta on warm dark. */
const WARM_WALLPAPER = 'linear-gradient(165deg, #f0b49c 0%, #d9826a 38%, #8a4a40 72%, #3b2a27 100%)';

const REST = { wide: { x: 700, y: 460 }, compact: { x: 280, y: 400 } };

/** Follows the site's light/dark switch (data-theme on <html>, dark by default and during SSR). */
function useSiteTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export default function CoveDemo({ lang }: { lang: Lang }) {
  const d = dict(lang).hero;
  const theme = useSiteTheme();
  const [sara, amir, mine] = d.chat;

  async function script(a: Act<S>) {
    await a.wait(1400);
    await a.move({ at: 'compose', x: 0.4, y: 0.5 });
    await a.click();
    await a.set({ focus: true });
    await a.type('draft', mine, { interval: 42 });
    await a.wait(420);
    await a.key('enter');
    await a.set({ draft: '', sent: true });
    await a.wait(1500);
    await a.move({ at: 'call', x: 0.5, y: 0.5 });
    await a.wait(260);
    await a.click();
    await a.set({ call: true, focus: false });
    await a.move(a.layout === 'compact' ? REST.compact : REST.wide);
    await a.wait(4200);
  }

  const convos = [
    { name: 'launch-crew', sub: 'Sara: ready to ship', unread: true },
    { name: 'design-team', sub: amir, selected: true },
    { name: 'Sara', sub: 'Online' },
    { name: 'general', sub: 'You: see you at 6' },
  ];

  return (
    <div className="cv-wrap" dir="ltr">
      <Stage
        width={980}
        height={560}
        compact={{ below: 760, width: 420, height: 470 }}
        initial={initial}
        poster={poster}
        script={script}
        play="once"
        theme={theme}
        accent={theme === 'light' ? '#c4624a' : '#d9826a'}
        cursor={{ at: REST, style: 'real' }}
        className="cv"
      >
        {(s, _rect, layout) => (
          <>
            <Window
              title="Cove"
              className="cv-window"
              sidebar={layout === 'compact' ? undefined : (
                <div className="cv-side">
                  <div className="cv-side__search"><Icon name="search" size={14} /><Text>{d.ui.search}</Text></div>
                  {convos.map((c) => (
                    <Row
                      key={c.name}
                      lead={<Avatar name={c.name} size={30} />}
                      title={c.name}
                      subtitle={c.sub}
                      unread={c.unread}
                      selected={c.selected}
                      pad={8}
                    />
                  ))}
                </div>
              )}
              sidebarWidth={236}
            >
              <div className="cv-main">
                <header className="cv-head">
                  <Avatar name="design-team" size={30} />
                  <span className="cv-head__who">
                    <Text className="cv-head__name">design-team</Text>
                    <Text className="cv-head__sub">{d.ui.channelDesc}</Text>
                  </span>
                  <span className="cv-grow" />
                  {s.call && layout !== 'compact' && (
                    <Badge tone="success" dot>{d.callTitle}</Badge>
                  )}
                  {s.call && layout !== 'compact' && <Facepile names={['Sara', 'Amir', 'Jo']} size={22} />}
                  <Button size="small" variant={s.call ? 'primary' : 'secondary'} icon={<PhoneIcon size={14} />} data-target="call" data-cursor="pointer">
                    {s.call ? d.callSub.split(' - ')[0] : d.callTitle}
                  </Button>
                </header>

                <Thread app="imessage" className="cv-thread">
                  <Stamp>10:02</Stamp>
                  <Bubble from="them" avatar={<Avatar name="Jo" size={24} />}><Bar w={150} h={6} tone={3} /></Bubble>
                  <Bubble from="me">{d.ui.typed}</Bubble>
                  <Bubble from="them" avatar={<Avatar name="Sara" size={24} />}>{sara}</Bubble>
                  <Bubble from="them" avatar={<Avatar name="Amir" size={24} />}>{amir}</Bubble>
                  {s.sent && <Bubble from="me" source="compose">{mine}</Bubble>}
                </Thread>

                <div className="cv-compose">
                  <Field
                    value={s.draft}
                    placeholder={d.ui.composer}
                    focused={s.focus}
                    box={{ 'data-target': 'compose', 'data-cursor': 'ibeam' }}
                  />
                </div>
              </div>
            </Window>

            {layout !== 'compact' && (
              <Phone width={248} frame="pro" dark wallpaper={WARM_WALLPAPER} className="cv-phone">
                <LockScreen size="satellite" stack="top">
                  <Notification icon={<Icon name="lock" filled size={20} />} title={d.lockTitle} body={d.lockSub} />
                </LockScreen>
              </Phone>
            )}
          </>
        )}
      </Stage>
    </div>
  );
}
