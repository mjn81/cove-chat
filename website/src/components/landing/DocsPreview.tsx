import { BookOpen, Cog, Lock, PhoneCall, Plug, Rocket, Search, ServerCog, Users, type LucideIcon } from 'lucide-react';
import { BlurFade, SpotlightCard } from './primitives';
import { dict, localUrl, type Lang } from '@/i18n';

const LINKS: { icon: LucideIcon; href: string }[] = [
  { icon: Rocket, href: '/docs/getting-started/quick-start/' },
  { icon: ServerCog, href: '/docs/self-hosting/docker/' },
  { icon: Cog, href: '/docs/configuration/reference/' },
  { icon: Lock, href: '/docs/security/encryption-model/' },
  { icon: PhoneCall, href: '/docs/configuration/voice-and-calls/' },
  { icon: Users, href: '/docs/administration/admin-panel/' },
  { icon: Plug, href: '/docs/api/rest/' },
  { icon: BookOpen, href: '/docs/contributing/development/' },
];

/** Docs entry points plus a static preview of the docs layout (the preview mimics the English docs). */
export default function DocsPreview({ lang }: { lang: Lang }) {
  const d = dict(lang).docs;
  return (
    <>
      <BlurFade>
        <a className="search" href={localUrl(lang, '/docs/')}><Search />{d.search}<kbd>Ctrl K</kbd></a>
      </BlurFade>
      <div className="dgrid">
        {LINKS.map((l, i) => (
          <BlurFade key={l.href} delay={i * 0.04}>
            <SpotlightCard as="a" href={localUrl(lang, l.href)} className="dcard">
              <l.icon /><b>{d.cards[i].title}</b><small>{d.cards[i].sub}</small>
            </SpotlightCard>
          </BlurFade>
        ))}
      </div>
      <BlurFade>
        <div className="docs" aria-hidden="true">
          <aside>
            <h6>Getting started</h6><span>Introduction</span><span className="on">Quick start</span><span>Architecture</span>
            <h6>Self-hosting</h6><span>Requirements</span><span>Docker</span><span>Reverse proxy and TLS</span><span>Backups</span>
          </aside>
          <main>
            <h4>Quick start</h4>
            <p>Run your own Cove server with Docker in about five minutes.</p>
            <div className="code mono">docker compose up -d</div>
            <div className="callout"><b>Tip.</b> Back up your master password. Losing it makes the database unrecoverable.</div>
            <p>Open the web client and create the first account. It becomes the owner.</p>
          </main>
          <div className="toc"><b style={{ color: 'var(--fg)' }}>On this page</b><span style={{ color: 'var(--primary)' }}>Requirements</span><span>Run the server</span><span>Create the owner</span><span>Next steps</span></div>
        </div>
      </BlurFade>
    </>
  );
}
