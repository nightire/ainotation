import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createFeedbackDocument } from '@ainotation/schema';
import { createFeedbackDownloads } from './handoff';

afterEach(() => vi.restoreAllMocks());

it('releases download URLs on activation failure and on repeated destruction', () => {
  const downloads = createFeedbackDownloads();
  vi.spyOn(URL, 'createObjectURL')
    .mockReturnValueOnce('blob:failed')
    .mockReturnValueOnce('blob:success');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementationOnce(() => {
    throw new Error('Blocked download');
  });
  const document = createFeedbackDocument(location.href);
  try {
    expect(() => downloads.exportJson(document)).toThrow('Blocked download');
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:failed');
    click.mockImplementation(() => {});
    downloads.exportJson(document);
    downloads.destroy();
    downloads.destroy();
    expect(revoke.mock.calls).toEqual([['blob:failed'], ['blob:success']]);
    expect(() => downloads.exportJson(document)).toThrow('Inspector downloads are closed.');
  } finally {
    downloads.destroy();
  }
});
