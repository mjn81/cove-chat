import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Languages, Menu, X } from 'lucide-react';
import ThemeToggle from '../ThemeToggle';
import { GithubIcon, NumberTicker } from './primitives';
import { APP_NAME, REPO_URL, url } from '@/lib/site';
import { LANGS, LANG_META, dict, localUrl, switchLangPath, type Lang } from '@/i18n';

export interface NavLink {
  label: string;
  href: string;
}

/** Popover that closes on outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function Pop({ children }: { children: ReactNode }) {
  return (
    <motion.div className="pop" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.16 }}>
      {children}
    </motion.div>
  );
}

/** Language picker. Links to the same page in the other language (computed on the client). */
function LangSelect({ lang, label }: { lang: Lang; label: string }) {
  const { open, setOpen, ref } = usePopover();
  const [path, setPath] = useState('');
  useEffect(() => setPath(window.location.pathname), []);
  return (
    <div className="lang-wrap" ref={ref}>
      <button type="button" className="icon-btn lang-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Languages />{LANG_META[lang].short}
      </button>
      <AnimatePresence>
        {open && (
          <Pop>
            {LANGS.map((l) => (
              <a key={l} href={path ? switchLangPath(path, l) : localUrl(l, '/')} hrefLang={l} lang={l} className={l === lang ? 'cur' : undefined}>
                {LANG_META[l].label}{l === lang && <Check />}
              </a>
            ))}
          </Pop>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Floating pill navigation: sliding hover highlight, language picker, theme ripple, mobile menu. */
export default function Nav({ links, stars, lang }: { links: NavLink[]; stars: number | null; lang: Lang }) {
  const d = dict(lang);
  const [hover, setHover] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const menu = usePopover();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <motion.nav
      className={`nav ${scrolled ? 'scrolled' : ''}`}
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      <a className="logo" href={localUrl(lang, '/')}>
        <img src={url('/favicon.svg')} width={26} height={26} alt="" style={{ display: 'block' }} />
        {APP_NAME}
      </a>
      <div className="nav-links" onMouseLeave={() => setHover(null)}>
        {links.map((l) => (
          <a key={l.href} href={l.href} onMouseEnter={() => setHover(l.href)}>
            {hover === l.href && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            {l.label}
          </a>
        ))}
      </div>
      <a className="gh-pill" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={d.nav.github}>
        <GithubIcon />
        {stars !== null && stars > 0 ? <span className="num"><NumberTicker value={stars} /></span> : <span>{d.nav.star}</span>}
      </a>
      <LangSelect lang={lang} label={d.nav.language} />
      <ThemeToggle lightLabel={d.nav.toLight} darkLabel={d.nav.toDark} />
      <div className="menu-wrap" ref={menu.ref}>
        <button type="button" className="icon-btn menu-btn" aria-label={d.nav.menu} aria-expanded={menu.open} onClick={() => menu.setOpen(!menu.open)}>
          {menu.open ? <X size={16} /> : <Menu size={16} />}
        </button>
        <AnimatePresence>
          {menu.open && (
            <Pop>
              {links.map((l) => (
                <a key={l.href} href={l.href} onClick={() => menu.setOpen(false)}>{l.label}</a>
              ))}
            </Pop>
          )}
        </AnimatePresence>
      </div>
    </motion.nav>
  );
}
