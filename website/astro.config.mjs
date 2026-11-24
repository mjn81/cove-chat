// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Production lives at https://covechat.dev (GitHub Pages custom domain, see public/CNAME). Override with SITE_URL / SITE_BASE for previews (for example a project path like /cove-chat).
const site = process.env.SITE_URL || 'https://covechat.dev';
const base = process.env.SITE_BASE || '/';

/**
 * Slugs (e.g. 'docs/getting-started/quick-start') that have a real translation under src/content/docs/<lang>.
 * @param {string} lang
 * @returns {Set<string>}
 */
function translatedSlugs(lang) {
  const dir = join('src/content/docs', lang);
  /** @type {Set<string>} */
  const out = new Set();
  /** @param {string} d */
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.add(relative(dir, p).replaceAll('\\', '/').replace(/\.(mdx?|markdown)$/, '').replace(/\/index$/, ''));
    }
  };
  walk(dir);
  return out;
}
/** @type {Record<string, Set<string>>} */
const translated = { fa: translatedSlugs('fa'), ar: translatedSlugs('ar'), ru: translatedSlugs('ru') };

/**
 * Untranslated fa/ar/ru docs pages are English fallbacks (noindex), so they stay out of the sitemap.
 * @param {string} page
 */
function inSitemap(page) {
  // Strip the base (with or without a trailing slash) but keep the leading slash the pattern expects.
  const path = new URL(page).pathname.slice(base.replace(/\/$/, '').length);
  const m = path.match(/^\/(fa|ar|ru)\/(docs(?:\/.*)?)$/);
  if (!m) return true;
  const slug = m[2].replace(/\/$/, '');
  // The docs landing is `<lang>/docs/index.mdx`, whose slug is already `docs`.
  return translated[m[1]].has(slug);
}

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [
    react(),
    sitemap({ filter: inSitemap }),
    starlight({
      title: 'Cove',
      description: 'Documentation for Cove, the self-hosted encrypted chat platform.',
      logo: { src: './src/assets/cove-mark.svg', alt: 'Cove' },
      favicon: '/favicon.svg',
      routeMiddleware: './src/route-middleware.ts',
      head: [
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}/apple-touch-icon.png` } },
        { tag: 'link', attrs: { rel: 'manifest', href: `${base}/manifest.webmanifest` } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#23201f' } },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mjn81/cove-chat' }],
      editLink: { baseUrl: 'https://github.com/mjn81/cove-chat/edit/main/website/' },
      customCss: ['./src/styles/tokens.css', './src/styles/docs.css'],
      components: {
        ThemeSelect: './src/components/docs/ThemeSelect.astro',
      },
      // English lives at the root; fa, ar and ru fall back to English pages (with a notice) until translated.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        fa: { label: 'فارسی', lang: 'fa', dir: 'rtl' },
        ar: { label: 'العربية', lang: 'ar', dir: 'rtl' },
        ru: { label: 'Русский', lang: 'ru' },
      },
      lastUpdated: true,
      sidebar: [
        { label: 'Getting started', translations: { fa: 'شروع کار', ar: 'البدء', ru: 'Начало работы' }, items: [{ autogenerate: { directory: 'docs/getting-started' } }] },
        { label: 'Self-hosting', translations: { fa: 'خودمیزبانی', ar: 'الاستضافة الذاتية', ru: 'Свой сервер' }, items: [{ autogenerate: { directory: 'docs/self-hosting' } }] },
        { label: 'Configuration', translations: { fa: 'پیکربندی', ar: 'التهيئة', ru: 'Конфигурация' }, items: [{ autogenerate: { directory: 'docs/configuration' } }] },
        { label: 'Administration', translations: { fa: 'مدیریت', ar: 'الإدارة', ru: 'Администрирование' }, items: [{ autogenerate: { directory: 'docs/administration' } }] },
        { label: 'Security', translations: { fa: 'امنیت', ar: 'الأمان', ru: 'Безопасность' }, items: [{ autogenerate: { directory: 'docs/security' } }] },
        { label: 'Clients', translations: { fa: 'کلاینت‌ها', ar: 'العملاء', ru: 'Клиенты' }, items: [{ autogenerate: { directory: 'docs/clients' } }] },
        { label: 'API', translations: { fa: 'API', ar: 'API', ru: 'API' }, items: [{ autogenerate: { directory: 'docs/api' } }] },
        { label: 'Contributing', translations: { fa: 'مشارکت', ar: 'المساهمة', ru: 'Участие в разработке' }, items: [{ autogenerate: { directory: 'docs/contributing' } }] },
        { label: 'Reference', translations: { fa: 'مرجع', ar: 'مرجع', ru: 'Справочник' }, items: [{ autogenerate: { directory: 'docs/reference' } }] },
      ],
    }),
  ],
});
