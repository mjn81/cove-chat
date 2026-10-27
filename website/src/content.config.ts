import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Optional per-language overrides of Starlight's own UI strings (src/content/i18n/<lang>.json).
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
