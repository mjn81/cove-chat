import { Badge, Bar, Code, Row, Stage, Text, Window } from '../stageshow/kit';
import '../stageshow/kit/stageshow.css';
import './cove-stage.css';
import './cove-scenes.css';
import { useSiteTheme } from './useSiteTheme';

const NAV = ['Introduction', 'Quick start', 'Architecture', 'Requirements', 'Docker', 'Backups'];
const TOC = ['Requirements', 'Run the server', 'Create the owner'];

/**
 * Stageshow still of the docs layout: a browser window with the section list, one page and its outline.
 * It mimics the English docs, so it stays English in every language, like the page it stands for.
 */
export default function CoveDocs() {
  const theme = useSiteTheme();
  return (
    <div className="cs-wrap" dir="ltr">
      <Stage width={880} height={340} compact={{ below: 640, width: 400, height: 340 }} fill theme={theme} className="cove-ss cs-docs">
        {(_s, _rect, layout) => (
          <Window url="cove.example/docs/quick-start" className="cs-docs__window" sidebarWidth={190}
            sidebar={layout === 'compact' ? undefined : (
              <div className="cs-docs__side">
                {NAV.map((n, i) => <Row key={n} title={n} selected={i === 1} pad={7} />)}
              </div>
            )}>
            <div className="cs-docs__page">
              <div className="cs-docs__main">
                <Text className="cs-docs__h">Quick start</Text>
                <Text className="cs-docs__p" wrap>Run your own Cove server with Docker in about five minutes.</Text>
                <Code lines={['curl -O compose.yml', 'docker compose up -d']} numbers={false} />
                <Badge tone="accent">Back up your master password</Badge>
                <Bar w="80%" h={6} tone={2} />
                <Bar w="60%" h={6} tone={2} />
              </div>
              {layout !== 'compact' && (
                <div className="cs-docs__toc">
                  <Text className="cs-docs__toc-h">On this page</Text>
                  {TOC.map((t, i) => <Text key={t} className="cs-docs__toc-i" data-on={i === 0 || undefined}>{t}</Text>)}
                </div>
              )}
            </div>
          </Window>
        )}
      </Stage>
    </div>
  );
}
