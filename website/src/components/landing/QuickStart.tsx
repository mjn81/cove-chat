import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView } from 'motion/react';
import { Check, Copy } from 'lucide-react';
import { BlurFade, BorderBeam } from './primitives';
import { DOCKER_SERVER_IMAGE, DOCKER_WEB_IMAGE, REPO_URL } from '@/lib/site';
import { dict, type Lang } from '@/i18n';

interface Tab {
  id: string;
  label: string;
  /** Lines of [kind, text]; kind c = comment, k = command, s = success output. */
  lines: [kind: 'c' | 'k' | 's' | '', text: string][];
}

const TABS: Tab[] = [
  {
    id: 'docker',
    label: 'Docker',
    lines: [
      ['c', '# 1. Create a folder with the production compose file and a config'],
      ['k', `curl -O ${REPO_URL}/raw/main/examples/docker-compose/production/docker-compose.yml`],
      ['k', `curl -o config.toml ${REPO_URL}/raw/main/backend/config.toml.example`],
      ['c', '# 2. Start the server and the web client'],
      ['k', 'docker compose up -d'],
      ['s', 'cove ready: web client on :3000, API on :4000'],
    ],
  },
  {
    id: 'binary',
    label: 'Binary',
    lines: [
      ['c', '# 1. Download the server for your OS from the latest release'],
      ['k', 'unzip cove-server-linux-amd64.zip'],
      ['k', `curl -o config.toml ${REPO_URL}/raw/main/backend/config.toml.example`],
      ['c', '# 2. Run it (the web client is a separate static build or image)'],
      ['k', 'chmod +x cove-server-linux-amd64 && ./cove-server-linux-amd64'],
      ['s', 'listening on :4000'],
    ],
  },
  {
    id: 'source',
    label: 'From source',
    lines: [
      ['c', '# Requires Go 1.25, Node and pnpm'],
      ['k', `git clone ${REPO_URL} && cd cove-chat`],
      ['k', 'make build'],
      ['k', 'make front/install && make front/build'],
      ['s', 'binary: ./cove-server, web client: client-web/dist'],
    ],
  },
];

const TOTAL = (t: Tab) => t.lines.reduce((n, [, s]) => n + s.length, 0);

/** Tabbed terminal that types its commands once visible, with a copy button for the commands only. */
export default function QuickStart({ lang }: { lang: Lang }) {
  const d = dict(lang).quick;
  const [tab, setTab] = useState(TABS[0].id);
  const [typed, setTyped] = useState(0);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px' });
  const cur = TABS.find((t) => t.id === tab)!;

  useEffect(() => {
    if (!inView) return;
    setTyped(0);
    const total = TOTAL(cur);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setTyped(total);
      return;
    }
    let n = 0;
    const t = setInterval(() => {
      n += 3;
      setTyped(n);
      if (n >= total) clearInterval(t);
    }, 18);
    return () => clearInterval(t);
  }, [inView, cur]);

  /** Renders a tab's lines, revealing only  characters (the rest is simply not drawn). */
  const renderTab = (t: Tab, count: number) => {
    let left = count;
    return t.lines.map(([k, str], i) => {
      const take = Math.max(0, Math.min(str.length, left));
      left -= str.length;
      return take > 0 ? (
        <div key={i} className={k || undefined}>{str.slice(0, take)}{take < str.length ? <span className="caret" /> : null}</div>
      ) : null;
    });
  };

  const copy = async () => {
    const text = cur.lines.filter(([k]) => k === 'k').map(([, s]) => s).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard can be denied; the commands remain selectable */
    }
  };

  return (
    <div ref={ref}>
      <BlurFade>
        <div className="term beam-host" style={{ ['--radius' as string]: '14px' }}>
          <BorderBeam size={140} duration={11} />
          <div className="term-bar">
            <div className="term-dots"><i /><i /><i /></div>
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`term-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
                {tab === t.id && <motion.span layoutId="term-tab" className="bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                {d.tabs[TABS.indexOf(t)]}
              </button>
            ))}
            <button type="button" className="term-copy" onClick={copy} aria-label="Copy commands">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={copied ? 'c' : 'n'} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.15 }} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {copied ? <Check /> : <Copy />}{copied ? d.copied : d.copy}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
          <pre className="term-body">
            {/* Every tab is laid out in the same grid cell, invisible unless active, so the box is always as tall as the longest tab and never shifts the page while typing. */}
            {TABS.map((t) => (
              <div key={t.id} className={t.id === tab ? 'term-pane on' : 'term-pane'} aria-hidden={t.id !== tab}>
                {t.id === tab ? renderTab(t, typed) : renderTab(t, Infinity)}
              </div>
            ))}
          </pre>
        </div>
      </BlurFade>
      <BlurFade delay={0.1}>
        <div className="qs-steps">
          {d.steps.map((st, i) => (
            <div key={st.title}><b><span>{i + 1}</span>{st.title}</b>{st.text}{i === 0 ? <> <span className="mono">{DOCKER_SERVER_IMAGE}</span>, <span className="mono">{DOCKER_WEB_IMAGE}</span></> : null}</div>
          ))}
        </div>
      </BlurFade>
    </div>
  );
}
