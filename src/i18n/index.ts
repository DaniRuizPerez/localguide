import { EN, type Strings } from './strings';
import { TRANSLATIONS } from './translations';
import { getLocale, LOCALE_NATIVE_NAME, LOCALE_SPEECH_TAG, type Locale } from './locale';

export type TKey = { [K in keyof Strings]: `${K}.${Extract<keyof Strings[K], string>}` }[keyof Strings];

// Extract {placeholder} var names from an EN baseline template so `t(key, vars)`
// can require exactly the right keys. Recursive template-literal types walk the
// string at type-check time.
type ExtractVars<S extends string> = S extends `${string}{${infer V}}${infer Rest}`
  ? V | ExtractVars<Rest>
  : never;

// Resolve a path like 'chat.placeholder' to the string literal type in EN so
// ExtractVars can mine its vars.
type StringAt<P extends TKey> = P extends `${infer G}.${infer K}`
  ? G extends keyof Strings
    ? K extends keyof Strings[G]
      ? Strings[G][K] extends string
        ? Strings[G][K]
        : never
      : never
    : never
  : never;

export type VarsFor<P extends TKey> = ExtractVars<StringAt<P>>;

// Type-level partition: keys whose template has no {vars} vs. keys that do.
export type NoVarKey = { [P in TKey]: [VarsFor<P>] extends [never] ? P : never }[TKey];
type WithVarsKey = Exclude<TKey, NoVarKey>;

function resolve(locale: Locale, group: keyof Strings, key: string): string {
  const override = (TRANSLATIONS[locale] as any)?.[group]?.[key];
  if (typeof override === 'string') return override;
  return (EN[group] as any)[key] ?? '';
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

/**
 * Pure string lookup — no hook needed. `t('chat.placeholder')` returns the
 * user-locale string with fallback to English.
 *
 * Split into two overloads so TypeScript enforces vars at compile time:
 * - Keys whose template has no {placeholder}: `t('chat.placeholder')`
 * - Keys whose template has {placeholders}: `t('map.stopsPickedOut', { count })`
 *
 * Calling a with-vars key without vars, or passing wrong keys in vars, is a
 * type error.
 */
export function t(path: NoVarKey): string;
export function t<P extends WithVarsKey>(path: P, vars: Record<VarsFor<P>, string | number>): string;
export function t(path: TKey, vars?: Record<string, string | number>): string {
  const [group, key] = path.split('.') as [keyof Strings, string];
  const template = resolve(getLocale(), group, key);
  return interpolate(template, vars);
}

// Returns the user's locale code ('en', 'es', …). Cheap — cached.
export { getLocale } from './locale';
export { LOCALE_NATIVE_NAME, LOCALE_SPEECH_TAG };
export type { Locale } from './locale';

// Human-readable name of the current locale, in that locale. Used in prompts.
export function currentLocaleNativeName(): string {
  return LOCALE_NATIVE_NAME[getLocale()];
}

// BCP-47 tag for TTS.
export function currentSpeechTag(): string {
  return LOCALE_SPEECH_TAG[getLocale()];
}

// Short directive to append to system prompts so the model answers in the
// user's language. Omitted for English to keep the prompt lean.
export function localePromptDirective(): string {
  const loc = getLocale();
  if (loc === 'en') return '';
  return `Always respond in ${LOCALE_NATIVE_NAME[loc]}.`;
}
