import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { getTheme, toggleTheme, type Theme } from '@/lib/theme';

/**
 * Round theme switch. Clicking ripples the new theme outward from the button (see `toggleTheme`).
 * @param props.lightLabel Accessible name while the theme is dark (switches to light).
 * @param props.darkLabel Accessible name while the theme is light.
 */
export default function ThemeToggle({
  lightLabel = 'Switch to light theme',
  darkLabel = 'Switch to dark theme',
  className = '',
}: {
  lightLabel?: string;
  darkLabel?: string;
  className?: string;
}) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(getTheme());
    const obs = new MutationObserver(() => setTheme(getTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      aria-label={theme === 'dark' ? lightLabel : darkLabel}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        void toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.25 }}
          style={{ display: 'grid' }}
        >
          {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
