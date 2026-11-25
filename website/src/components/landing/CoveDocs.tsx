import { Badge, Bar, Code, Row, Stage, Text, Window } from '../stageshow/kit';
import '../stageshow/kit/stageshow.css';
import './cove-stage.css';
import './cove-scenes.css';
import { useSiteTheme } from './useSiteTheme';
import { dict, type Lang } from '@/i18n';

/**
 * Stageshow still of the docs layout: a browser window with the section list, one page and its outline.
 * The address and the commands stay in Latin script in every language, as they do in the real docs.
 */
export default function CoveDocs({ lang }: { lang: Lang }) {
  const d = dict(lang).docs.preview;
  const theme = useSiteTheme();
  return (
    <div className="cs-wrap" dir="ltr">
      <Stage width={880} height={340} compact={{ below: 640, width: 400, height: 340 }} fill theme={theme} className="cove-ss cs-docs">
        {(_s, _rect, layout) => (
          <Window url="cove.example/docs/quick-start" className="cs-docs__window" sidebarWidth={190}
            sidebar={layout === 'compact' ? undefined : (
              <div className="cs-docs__side">
                {d.nav.map((n, i) => <Row key={n} title={n} selected={i === 1} pad={7} />)}
              </div>
            )}>
            <div className="cs-docs__page">
              <div className="cs-docs__main">
                <Text className="cs-docs__h">{d.title}</Text>
                <Text className="cs-docs__p" wrap>{d.lead}</Text>
                <Code lines={['curl -O compose.yml', 'docker compose up -d']} numbers={false} />
                <Badge tone="accent">{d.tip}</Badge>
                <Bar w="80%" h={6} tone={2} />
                <Bar w="60%" h={6} tone={2} />
              </div>
              {layout !== 'compact' && (
                <div className="cs-docs__toc">
                  <Text className="cs-docs__toc-h">{d.onThisPage}</Text>
                  {d.toc.map((t, i) => <Text key={t} className="cs-docs__toc-i" data-on={i === 0 || undefined}>{t}</Text>)}
                </div>
              )}
            </div>
          </Window>
        )}
      </Stage>
    </div>
  );
}
