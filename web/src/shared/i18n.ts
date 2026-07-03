import { EN } from './dict';

/**
 * Developer-only language switch. **Russian is the constitution (P5): she must
 * only ever see Russian.** English exists solely so the developer can test the
 * apps more comfortably. Therefore:
 *   - The default is always 'ru'. English activates ONLY when localStorage
 *     explicitly holds lang='en' (set from the hidden dev panel or ?lang=en).
 *   - Translations are keyed by the Russian source string, so a missing entry
 *     falls back to Russian — the only safe direction. She can never see a raw
 *     key or English by accident.
 */

export type Lang = 'ru' | 'en';

function resolveInitialLang(): Lang {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('lang');
    if (fromUrl === 'en' || fromUrl === 'ru') {
      localStorage.setItem('lang', fromUrl);
      return fromUrl;
    }
    return localStorage.getItem('lang') === 'en' ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

// Fixed for the lifetime of the page load; changing it reloads (see setLang).
let currentLang: Lang = resolveInitialLang();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem('lang', lang);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/**
 * Translate a Russian source string. In 'ru' mode returns it unchanged; in
 * 'en' mode returns the mapped English (or the Russian if unmapped). Supports
 * `{name}` placeholders in either language: t('Сохранить в «{name}»', { name }).
 */
export function t(ru: string, params?: Record<string, string | number>): string {
  let out = currentLang === 'en' ? EN[ru] ?? ru : ru;
  if (params) {
    for (const key of Object.keys(params)) {
      out = out.split('{' + key + '}').join(String(params[key]));
    }
  }
  return out;
}

// When the language is flipped in another tab (e.g. the dev panel), reload
// any open app windows so they pick it up.
try {
  window.addEventListener('storage', (e) => {
    if (e.key === 'lang' && (e.newValue === 'en' || e.newValue === 'ru') && e.newValue !== currentLang) {
      window.location.reload();
    }
  });
} catch {
  /* non-browser context */
}
