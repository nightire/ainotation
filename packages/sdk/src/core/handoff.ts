import {
  feedbackExport,
  feedbackMarkdown,
  type FeedbackDocument,
  type OutputDetail,
} from '@ainotation/schema';

/** Start clipboard access synchronously; the payload can finish loading afterward. */
export async function copyProjectFeedback(
  records: Promise<FeedbackDocument[]>,
  current: FeedbackDocument,
  detail: OutputDetail,
  active: () => boolean,
): Promise<string> {
  const output = records.then((records) => {
    if (!active()) throw new Error('Inspector was unmounted before feedback could be copied.');
    const documents = records.filter((document) => document.annotations.length > 0);
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
    throw new Error('Clipboard access failed. Use Export JSON; feedback is still saved.');
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
  return {
    exportJson(feedback: FeedbackDocument) {
      if (destroyed) throw new Error('Inspector downloads are closed.');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(feedbackExport(feedback), null, 2)], { type: 'application/json' }),
      );
      urls.set(
        url,
        setTimeout(() => release(url), 10000),
      );
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `ainotation-${feedback.id}.json`;
        anchor.click();
      } catch (error) {
        release(url);
        throw error;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const url of urls.keys()) release(url);
    },
  };
}
