import {
  feedbackExport,
  feedbackMarkdown,
  imageFilename,
  type FeedbackDocument,
  type OutputDetail,
} from '@ainotation/schema';
import { uiError } from '../i18n';

/** Start clipboard access synchronously; the payload can finish loading afterward. */
export async function copyProjectFeedback(
  records: Promise<FeedbackDocument[]>,
  current: FeedbackDocument,
  detail: OutputDetail,
  active: () => boolean,
): Promise<string> {
  const output = records.then((records) => {
    if (!active()) throw new Error('Inspector was unmounted before feedback could be copied.');
    const documents = records.filter(
      (document) =>
        document.annotations.length > 0 ||
        document.variantCleanups?.some((entry) => entry.variants.status !== 'completed'),
    );
    const emptyPage = records.find((document) => document.url === current.url) ?? {
      ...current,
      annotations: [],
    };
    return (documents.length ? documents : [emptyPage])
      .map((document) => feedbackMarkdown(document, { detail }))
      .join('\n\n---\n\n');
  });
  const content = output.then((text) => new Blob([text], { type: 'text/plain' }));
  void content.catch(() => {});
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': content })]);
    } else await navigator.clipboard.writeText(await output);
  } catch {
    await output; // Preserve a storage/validation error instead of reporting a clipboard error.
    throw uiError('clipboardFailed');
  }
  return output;
}

export function createFeedbackDownloads() {
  const urls = new Map<string, ReturnType<typeof setTimeout>>();
  let destroyed = false;
  const release = (url: string) => {
    clearTimeout(urls.get(url));
    urls.delete(url);
    URL.revokeObjectURL(url);
  };
  const download = (blob: Blob, filename: string) => {
    if (destroyed) throw new Error('Inspector downloads are closed.');
    const url = URL.createObjectURL(blob);
    urls.set(
      url,
      setTimeout(() => release(url), 10000),
    );
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
    } catch (error) {
      release(url);
      throw error;
    }
  };
  return {
    download,
    async exportImages(feedback: FeedbackDocument, blobs: Record<string, Blob>) {
      const images = [
        ...new Map(
          feedback.annotations
            .flatMap((annotation) => annotation.images ?? [])
            .map((image) => [image.id, image]),
        ).values(),
      ];
      const entries = images.map((image) => {
        const blob = blobs[image.id];
        if (!blob) throw uiError('exportImagesPending');
        return { name: imageFilename(image), blob };
      });
      entries.unshift({
        name: 'feedback.json',
        blob: new Blob([JSON.stringify(feedbackExport(feedback), null, 2)], {
          type: 'application/json',
        }),
      });
      entries.unshift({
        name: 'feedback.md',
        blob: new Blob([feedbackMarkdown(feedback)], { type: 'text/markdown' }),
      });
      const { imageArchive } = await import('./image-archive');
      download(await imageArchive(entries), `ainotation-${feedback.id}.zip`);
    },
    exportJson(feedback: FeedbackDocument) {
      download(
        new Blob([JSON.stringify(feedbackExport(feedback), null, 2)], { type: 'application/json' }),
        `ainotation-${feedback.id}.json`,
      );
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const url of urls.keys()) release(url);
    },
  };
}
