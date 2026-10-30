import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { ArrowRight, ArrowUpRight, Check, Languages } from 'lucide-react';
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

/** Two-line hamburger that morphs into a cross. */
function MenuIcon({ open }: { open: boolean }) {
  const t = { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const };
  return (
    <span className="menu-ico" aria-hidden="true">
      <motion.span initial={false} animate={open ? { y: 0, rotate: 45 } : { y: -3, rotate: 0 }} transition={t} />
      <motion.span initial={false} animate={open ? { y: 0, rotate: -45 } : { y: 3, rotate: 0 }} transition={t} />
    </span>
  );
}

const listVariants: Variants = {
  open: { transition: { staggerChildren: 0.07, delayChildren: 0.2 } },
  closed: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
};
const itemVariants: Variants = {
  closed: { opacity: 0, y: 28 },
  open: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

/**
 * Full-screen mobile menu. It opens as a circle growing out of the menu button, then the links rise in one by one;
 * closing reverses it. Reduced-motion users get a plain fade.
 */
function MobileMenu({ open, links, lang, origin, onClose }: { open: boolean; links: NavLink[]; lang: Lang; origin: { x: number; y: number }; onClose: () => void }) {
  const d = dict(lang);
  const reduce = useReducedMotion();
  const radius = typeof window === 'undefined' ? 0 : Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y)) + 24;
  const clip = (r: number) => `circle(${r}px at ${origin.x}px ${origin.y}px)`;
  const reveal = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { clipPath: clip(0) }, animate: { clipPath: clip(radius) }, exit: { clipPath: clip(0), transition: { duration: 0.38, ease: [0.64, 0, 0.78, 0] as const } } };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="mnav" role="dialog" aria-modal="true" aria-label={d.nav.menu} data-lenis-prevent {...reveal} transition={{ duration: reduce ? 0.2 : 0.65, ease: [0.22, 1, 0.36, 1] }}>
          <motion.div className="mnav-body" variants={listVariants} initial="closed" animate="open" exit="closed">
            <nav className="mnav-links" aria-label={d.nav.menu}>
              {links.map((l, i) => (
                <motion.a key={l.href} href={l.href} className="mnav-link" variants={itemVariants} onClick={onClose}>
                  <span className="mnav-idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="mnav-label">{l.label}</span>
                  <ArrowUpRight className="mnav-arrow rtl-flip" />
                </motion.a>
              ))}
            </nav>
            <motion.div className="mnav-foot" variants={itemVariants}>
              <a className="btn primary" href={localUrl(lang, '/docs/getting-started/quick-start/')} onClick={onClose}>
                {d.hero.start} <ArrowRight className="rtl-flip" />
              </a>
              <a className="btn" href={REPO_URL} target="_blank" rel="noopener noreferrer">
                <GithubIcon /> {d.nav.github}
              </a>
              <span className="mnav-note">{APP_NAME} · {d.beta.chip}</span>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Floating pill navigation: sliding hover highlight, language picker, theme ripple, mobile menu. */
export default function Nav({ links, stars, lang }: { links: NavLink[]; stars: number | null; lang: Lang }) {
  const d = dict(lang);
  const [hover, setHover] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const menuBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  // The menu grows out of its button, so remember where the button is each time it opens.
  const toggleMenu = () => {
    const r = menuBtn.current?.getBoundingClientRect();
    if (r) setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setMenuOpen((v) => !v);
  };

  // While open: lock page scroll, close on Escape, and close when the viewport grows past the mobile breakpoint.
  useEffect(() => {
    if (!menuOpen) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const mq = window.matchMedia('(min-width: 761px)');
    const onMq = () => mq.matches && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    mq.addEventListener('change', onMq);
    return () => {
      html.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onMq);
    };
  }, [menuOpen]);

  return (
    <>
    <motion.nav
      className={`nav ${scrolled ? 'scrolled' : ''} ${menuOpen ? 'menu-open' : ''}`}
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      <a className="logo" href={localUrl(lang, '/')}>
        <img src={url('/favicon.svg')} width={26} height={26} alt="" style={{ display: 'block' }} />
        {APP_NAME}
        <span className="beta-chip">{d.beta.chip}</span>
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
      <button ref={menuBtn} type="button" className="icon-btn menu-btn" aria-label={d.nav.menu} aria-expanded={menuOpen} onClick={toggleMenu}>
        <MenuIcon open={menuOpen} />
      </button>
    </motion.nav>
    <MobileMenu open={menuOpen} links={links} lang={lang} origin={origin} onClose={() => setMenuOpen(false)} />
    </>
  );
}
