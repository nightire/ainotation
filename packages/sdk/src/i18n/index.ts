import { en, type Messages } from './en';
import { zhHans } from './zh-Hans';
import { zhHant } from './zh-Hant';
import { ja } from './ja';
import { ko } from './ko';

export const locales = ['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko'] as const;
export type Locale = (typeof locales)[number];
export const languageNames: Record<Locale, string> = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
};
const dictionaries: Record<Locale, Messages> = { en, 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko };
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && locales.includes(value as Locale);
}
export function messages(locale: Locale): Messages {
  return isLocale(locale) ? dictionaries[locale] : en;
}
export function detectLocale(languages: readonly string[] = navigator.languages): Locale {
  for (const value of languages) {
    let locale: Intl.Locale;
    try {
      locale = new Intl.Locale(value);
    } catch {
      continue;
    }
    if (locale.language === 'zh')
      return locale.maximize().script === 'Hant' ? 'zh-Hant' : 'zh-Hans';
    if (locale.language === 'en' || locale.language === 'ja' || locale.language === 'ko')
      return locale.language;
  }
  return 'en';
}

export type MessageKey = keyof Messages;
type PlainMessageKey = { [K in MessageKey]: Messages[K] extends string ? K : never }[MessageKey];
type Args<K extends MessageKey> = Messages[K] extends (...args: infer A) => string ? A : [];
export type UiMessage = { [K in MessageKey]: { key: K; args: Args<K> } }[MessageKey];
export function msg<K extends MessageKey>(key: K, ...args: Args<K>): UiMessage {
  return { key, args } as UiMessage;
}
export function formatMessage(locale: Locale, message: UiMessage | string): string {
  if (typeof message === 'string') return message;
  const value = messages(locale)[message.key];
  // The discriminated descriptor is constructed by msg(), which checks each key's parameters.
  return typeof value === 'string'
    ? value
    : (value as (...args: (string | number)[]) => string)(...message.args);
}
export class UiError extends Error {
  constructor(
    readonly description: UiMessage,
    options?: ErrorOptions,
  ) {
    super(formatMessage('en', description), options);
    this.name = 'UiError';
  }
}
export function uiError<K extends MessageKey>(key: K, ...args: Args<K>): UiError {
  return new UiError(msg(key, ...args));
}
export function errorMessage(
  error: unknown,
  fallback: PlainMessageKey = 'operationFailed',
): UiMessage {
  if (error instanceof UiError) return error.description;
  // Unknown browser/server diagnostics remain on the original error, rather than
  // requiring translation catalogs to recognize arbitrary English error text.
  return { key: fallback, args: [] } as UiMessage;
}

export function createI18n(initial: Locale = 'en') {
  let locale = initial;
  const listeners = new Set<() => void>();
  return {
    get locale() {
      return locale;
    },
    get messages() {
      return messages(locale);
    },
    setLocale(next: Locale) {
      if (!isLocale(next) || next === locale) return;
      locale = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void, signal: AbortSignal) {
      if (signal.aborted) return;
      listeners.add(listener);
      signal.addEventListener('abort', () => listeners.delete(listener), { once: true });
    },
  };
}
export type I18n = ReturnType<typeof createI18n>;
