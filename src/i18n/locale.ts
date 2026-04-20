import * as Localization from 'expo-localization';

// Locales we ship UI translations for. Everything else falls back to English.
export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'zh'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// Human-readable name of each language, in its own language — used when we
// ask the model to emit output in that language ("respond in español").
export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
  en: 'English',
  es: 'español',
  fr: 'français',
  de: 'Deutsch',
  it: 'italiano',
  pt: 'português',
  ja: '日本語',
  zh: '中文',
};

// BCP-47 tag for expo-speech. Pick a common regional variant — speech engines
// are more reliable with a specific region than bare language codes on Android.
export const LOCALE_SPEECH_TAG: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-PT',
  ja: 'ja-JP',
  zh: 'zh-CN',
};

function normalize(tag: string | null | undefined): Locale {
  if (!tag) return 'en';
  // expo-localization returns e.g. "es-419" or "zh-Hans-CN" — take the two-letter
  // base and snap to a supported locale.
  const base = tag.toLowerCase().split(/[-_]/)[0] as Locale;
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? base : 'en';
}

// Cached on first read so components don't re-hit native bridges every render.
// We don't currently observe locale changes at runtime (uncommon for travel
// apps — you change phone language in settings, the app is restarted).
let cachedLocale: Locale | null = null;

export function getLocale(): Locale {
  if (cachedLocale) return cachedLocale;
  try {
    const list = Localization.getLocales();
    const first = list?.[0];
    cachedLocale = normalize(first?.languageTag ?? first?.languageCode ?? null);
  } catch {
    cachedLocale = 'en';
  }
  return cachedLocale;
}

// Test hook — never called from production code.
export function __setLocaleForTest(locale: Locale | null) {
  cachedLocale = locale;
}
