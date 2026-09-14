import { expect, it } from 'vite-plus/test';
import { readLocale, writeLocale } from '../core/preferences';

it('keeps explicit language preferences scoped by project', async () => {
  const first = `language-${crypto.randomUUID()}`,
    second = `language-${crypto.randomUUID()}`;
  await writeLocale(first, 'ja');
  await writeLocale(second, 'zh-Hant');
  expect(await readLocale(first)).toBe('ja');
  expect(await readLocale(second)).toBe('zh-Hant');
  await writeLocale(first, 'ko');
  expect(await readLocale(first)).toBe('ko');
  expect(await readLocale(second)).toBe('zh-Hant');
});
