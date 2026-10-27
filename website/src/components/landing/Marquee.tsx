import { siGo, siReact, siTypescript, siTailwindcss, siDocker, siAndroid, siKotlin, siWebrtc, siVite, siAstro } from 'simple-icons';
import { Database, KeyRound, Lock, type LucideIcon } from 'lucide-react';

type Item = { name: string; path?: string; icon?: LucideIcon };

const ITEMS: Item[] = [
  { name: 'Go', path: siGo.path },
  { name: 'BadgerDB', icon: Database },
  { name: 'WebRTC', path: siWebrtc.path },
  { name: 'React', path: siReact.path },
  { name: 'TypeScript', path: siTypescript.path },
  { name: 'Vite', path: siVite.path },
  { name: 'Tailwind CSS', path: siTailwindcss.path },
  { name: 'Kotlin', path: siKotlin.path },
  { name: 'Android', path: siAndroid.path },
  { name: 'Docker', path: siDocker.path },
  { name: 'Argon2id', icon: KeyRound },
  { name: 'AES-256-GCM', icon: Lock },
  { name: 'Astro', path: siAstro.path },
];

/** Infinite logo strip of the stack. Duplicated once so the -50% translate loops seamlessly. */
export default function Marquee() {
  return (
    <div className="marq" aria-label="Built with">
      <div className="track">
        {[...ITEMS, ...ITEMS].map((it, i) => (
          <span key={`${it.name}-${i}`} aria-hidden={i >= ITEMS.length}>
            {it.path ? (
              <svg viewBox="0 0 24 24" role="img" aria-label={it.name}><path d={it.path} /></svg>
            ) : it.icon ? (
              <it.icon size={20} />
            ) : null}
            {it.name}
          </span>
        ))}
      </div>
    </div>
  );
}
