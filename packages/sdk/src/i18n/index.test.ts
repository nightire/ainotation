import { expect, it, vi } from 'vite-plus/test';
import {
  createI18n,
  detectLocale,
  messages,
  locales,
  formatMessage,
  msg,
  uiError,
  errorMessage,
} from './index';

it('matches browser language preferences with Chinese script precedence and English fallback', () => {
  for (const [input, expected] of [
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['zh-Hans-HK', 'zh-Hans'],
    ['zh-Hant-CN', 'zh-Hant'],
    ['ja-JP', 'ja'],
    ['ko-KR', 'ko'],
    ['en-GB', 'en'],
  ])
    expect(detectLocale([input!])).toBe(expected);
  expect(detectLocale(['fr-FR', 'ja-JP', 'en'])).toBe('ja');
  expect(detectLocale(['not_a_locale', 'ko'])).toBe('ko');
  expect(detectLocale(['fr-FR'])).toBe('en');
  expect(detectLocale([])).toBe('en');
});

it('has complete catalogs and formats dynamic messages without rewriting user text', () => {
  const keys = Object.keys(messages('en')).sort();
  for (const locale of locales) {
    expect(Object.keys(messages(locale)).sort()).toEqual(keys);
    expect(formatMessage(locale, msg('editImage', 3))).toContain('3');
    expect(formatMessage(locale, msg('invalidDimensions', 6016, 3384))).toContain('6016 × 3384');
    expect(formatMessage(locale, 'User-authored feedback')).toBe('User-authored feedback');
  }
  expect(formatMessage('en', msg('deleteShapes', 1))).toBe('Delete 1 shape');
  expect(formatMessage('en', msg('deleteShapes', 2))).toBe('Delete 2 shapes');
  const error = uiError('imageTooLarge', 6016, 3384);
  expect(error.message).toContain('Image is too large');
  expect(formatMessage('zh-Hans', errorMessage(error))).toContain('图片过大');
  expect(formatMessage('ja', errorMessage(new Error('Unknown technical details')))).toBe(
    messages('ja').operationFailed,
  );
});

it('keeps language state instance-scoped and removes subscriptions on teardown', () => {
  const first = createI18n('en'),
    second = createI18n('ko');
  const changed = vi.fn(),
    lifetime = new AbortController();
  first.subscribe(changed, lifetime.signal);
  first.setLocale('ja');
  expect(changed).toHaveBeenCalledOnce();
  expect(second.locale).toBe('ko');
  first.setLocale('ja');
  expect(changed).toHaveBeenCalledOnce();
  lifetime.abort();
  first.setLocale('zh-Hant');
  expect(changed).toHaveBeenCalledOnce();
});
