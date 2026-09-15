import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import fa from './locales/fa.json';
import ar from './locales/ar.json';

// RTL languages — used to set document direction dynamically.
// Farsi is deliberately NOT included: per product decision, switching to
// Farsi should only swap translated text, not flip the whole layout to RTL.
export const RTL_LANGUAGES = new Set(['ar', 'he', 'ur']);

const resources = {
  en: { translation: en },
  fa: { translation: fa },
  ar: { translation: ar },
};

// Detect saved language preference, fall back to browser language, then 'en'
const savedLang = localStorage.getItem('nodetalk_lang');
const browserLang = navigator.language.split('-')[0];
const defaultLang = savedLang ?? (resources[browserLang as keyof typeof resources] ? browserLang : 'en');

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: defaultLang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // React already handles XSS
  });

// Apply RTL/LTR to <html> whenever language changes
function applyDirection(lang: string) {
  const dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lang;
}

applyDirection(defaultLang);
i18n.on('languageChanged', applyDirection);

export default i18n;
