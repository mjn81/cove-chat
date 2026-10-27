// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';

// Override with SITE_URL / SITE_BASE when deploying to a custom domain or a GitHub Pages project path.
const site = process.env.SITE_URL ?? 'https://mjn81.github.io';
const base = process.env.SITE_BASE ?? '/nodetalk';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [
    react(),
    sitemap(),
    starlight({
      title: 'Cove',
      description: 'Documentation for Cove, the self-hosted encrypted chat platform.',
      logo: { src: './src/assets/cove-mark.svg', alt: 'Cove' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mjn81/nodetalk' }],
      editLink: { baseUrl: 'https://github.com/mjn81/nodetalk/edit/main/website/' },
      customCss: ['./src/styles/tokens.css', './src/styles/docs.css'],
      components: {
        ThemeSelect: './src/components/docs/ThemeSelect.astro',
      },
      // English lives at the root; fa and ar fall back to English pages (with a notice) until translated.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        fa: { label: 'فارسی', lang: 'fa', dir: 'rtl' },
        ar: { label: 'العربية', lang: 'ar', dir: 'rtl' },
      },
      lastUpdated: true,
      sidebar: [
        { label: 'Getting started', translations: { fa: 'شروع کار', ar: 'البدء' }, items: [{ autogenerate: { directory: 'docs/getting-started' } }] },
        { label: 'Self-hosting', translations: { fa: 'خودمیزبانی', ar: 'الاستضافة الذاتية' }, items: [{ autogenerate: { directory: 'docs/self-hosting' } }] },
        { label: 'Configuration', translations: { fa: 'پیکربندی', ar: 'التهيئة' }, items: [{ autogenerate: { directory: 'docs/configuration' } }] },
        { label: 'Administration', translations: { fa: 'مدیریت', ar: 'الإدارة' }, items: [{ autogenerate: { directory: 'docs/administration' } }] },
        { label: 'Security', translations: { fa: 'امنیت', ar: 'الأمان' }, items: [{ autogenerate: { directory: 'docs/security' } }] },
        { label: 'Clients', translations: { fa: 'کلاینت‌ها', ar: 'العملاء' }, items: [{ autogenerate: { directory: 'docs/clients' } }] },
        { label: 'API', translations: { fa: 'API', ar: 'API' }, items: [{ autogenerate: { directory: 'docs/api' } }] },
        { label: 'Contributing', translations: { fa: 'مشارکت', ar: 'المساهمة' }, items: [{ autogenerate: { directory: 'docs/contributing' } }] },
        { label: 'Reference', translations: { fa: 'مرجع', ar: 'مرجع' }, items: [{ autogenerate: { directory: 'docs/reference' } }] },
      ],
    }),
  ],
});
