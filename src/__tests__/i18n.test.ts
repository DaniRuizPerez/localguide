/**
 * i18n foundation — device locale detection, string resolution with fallback,
 * prompt directive, and TTS tag.
 */

const mockGetLocales = jest.fn();

jest.mock('expo-localization', () => ({
  getLocales: () => mockGetLocales(),
  getCalendars: jest.fn(() => []),
}));

// Re-require the modules after each test so the module-level cache in
// locale.ts picks up the new mock return value.
function load(locale: string | null) {
  jest.resetModules();
  if (locale == null) {
    mockGetLocales.mockReturnValue([]);
  } else {
    mockGetLocales.mockReturnValue([{ languageTag: locale, languageCode: locale.split('-')[0] }]);
  }
  const i18n = require('../i18n');
  return i18n as typeof import('../i18n');
}

describe('i18n', () => {
  beforeEach(() => {
    mockGetLocales.mockReset();
  });

  it('falls back to English when device locale is unsupported', () => {
    const { t, getLocale } = load('eo-XX'); // Esperanto — not shipped
    expect(getLocale()).toBe('en');
    expect(t('chat.placeholder')).toBe("Ask about what's near you…");
  });

  it('resolves Spanish strings when device is es-ES', () => {
    const { t, getLocale } = load('es-ES');
    expect(getLocale()).toBe('es');
    expect(t('chat.placeholder')).toBe('¿Qué hay cerca de ti?');
    expect(t('nav.map')).toBe('Mapa');
  });

  it('accepts es-419 (Latin American Spanish) and maps to es', () => {
    const { t } = load('es-419');
    expect(t('nav.chat')).toBe('Chat');
    expect(t('topics.food')).toBe('Comida');
  });

  it('falls back to English for missing keys in partial translations', () => {
    // German translation in src/i18n/translations.ts omits map.wikipedia — that
    // key must fall back to English rather than render blank.
    const { t } = load('de-DE');
    expect(t('chat.autoGuide')).toBe('AUTO-GUIDE');
    expect(t('map.wikipedia')).toBe('Wikipedia');
    // app.ready isn't translated in DE either
    expect(t('app.ready')).toBe('Ready when you are');
  });

  it('interpolates {count}-style vars', () => {
    const { t } = load('en-US');
    expect(t('map.stopsPickedOut', { count: 3 })).toBe('3 stops your guide picked out');
  });

  it('leaves the token intact when an interpolation var is missing', () => {
    const { t } = load('en-US');
    expect(t('app.warmupError', {} as any)).toBe('Warmup error: {message}');
  });

  it('emits a locale directive for non-English prompts', () => {
    const { localePromptDirective } = load('fr-FR');
    expect(localePromptDirective()).toContain('français');
  });

  it('emits an empty directive for English so prompts stay lean', () => {
    const { localePromptDirective } = load('en-US');
    expect(localePromptDirective()).toBe('');
  });

  it('picks a BCP-47 speech tag for the TTS engine', () => {
    const { currentSpeechTag } = load('ja-JP');
    expect(currentSpeechTag()).toBe('ja-JP');
  });

  it('handles null / empty locale list gracefully', () => {
    const { getLocale } = load(null);
    expect(getLocale()).toBe('en');
  });
});

// Type-level smoke test — does not execute at runtime. If any of the
// ts-expect-error comments below stop triggering a real error, tsc fails
// the build ("unused directive"), so these are effectively compile-time
// tests. Static import preserves the generic signature through inference.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeOnlyChecks() {
  // OK — no vars needed.
  tDirect('chat.placeholder');

  // OK — required vars supplied.
  tDirect('map.stopsPickedOut', { count: 3 });

  // @ts-expect-error map.stopsPickedOut has {count}, vars arg is required.
  tDirect('map.stopsPickedOut');

  // @ts-expect-error wrong var name — 'count' is required, not 'wrong'.
  tDirect('map.stopsPickedOut', { wrong: 3 });
}

// Separate import so the generic preserves through static analysis.
import { t as tDirect } from '../i18n';
