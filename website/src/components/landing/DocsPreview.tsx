import { BookOpen, Cog, Lock, PhoneCall, Plug, Rocket, Search, ServerCog, Users, type LucideIcon } from 'lucide-react';
import { BlurFade, SpotlightCard } from './primitives';
import CoveDocs from './CoveDocs';
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

/** Docs entry points plus a static preview of the docs layout. */
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
        <CoveDocs lang={lang} />
      </BlurFade>
    </>
  );
}
