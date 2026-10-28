import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

/**
 * Per-page SEO for the docs:
 * - pages that are only an untranslated fallback (English text served under /fa or /ar) are kept out of
 *   the index and canonicalised to the English original, so they never compete with it as duplicate content;
 * - every page gets TechArticle structured data and a social image.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const { starlightRoute } = context.locals;
  const { head, entry, isFallback } = starlightRoute;
  const site = context.site;
  if (!site) return;

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const abs = (p: string) => new URL(p, site).href;
  const image = abs(`${base}/og.png`);

  head.push(
    { tag: 'meta', attrs: { property: 'og:image', content: image } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { property: 'og:site_name', content: 'Cove' } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
    { tag: 'meta', attrs: { name: 'author', content: 'mjn' } },
  );

  if (isFallback) {
    const pathname = context.url.pathname;
    const english = pathname.replace(/^(.*?)\/(fa|ar)\/docs\//, '$1/docs/');
    for (const tag of head) {
      if (tag.tag === 'link' && tag.attrs?.rel === 'canonical') tag.attrs.href = abs(english);
    }
    head.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex, follow' } });
    return;
  }

  head.push({
    tag: 'script',
    attrs: { type: 'application/ld+json' },
    content: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: entry.data.title,
      description: entry.data.description,
      inLanguage: starlightRoute.lang,
      url: context.url.href,
      image,
      author: { '@type': 'Person', name: 'mjn', url: 'https://github.com/mjn81' },
      publisher: { '@type': 'Person', name: 'mjn' },
      isPartOf: { '@type': 'WebSite', name: 'Cove', url: abs(`${base}/`) },
    }),
  });
});
