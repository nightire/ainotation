import { requestCapture } from '../../../packages/sdk/src/core/capture';
import { describeImage } from '../../../packages/sdk/src/core/images';
import { createI18n, errorMessage, formatMessage } from '../../../packages/sdk/src/i18n';

export type PrototypeImage = {
  metadata: Awaited<ReturnType<typeof describeImage>>;
  blob: Blob;
  url: string;
};

/** Reuses the production editor; only attachment persistence is in-memory here. */
export class PrototypeImages {
  busy = false;
  private lifetime = new AbortController();
  private urls = new Map<string, string>();
  private i18n = createI18n('zh-Hans');

  constructor(
    private options: {
      getImages: () => PrototypeImage[];
      setImages: (images: PrototypeImage[]) => void;
      theme: () => 'light' | 'dark';
      changed: () => void;
      message: (message: string) => void;
    },
  ) {}

  choose(blob: Blob, replaceId?: string) {
    if (this.busy || (!replaceId && this.options.getImages().length >= 8)) return;
    void this.edit(Promise.resolve({ blob }), 'import', replaceId);
  }

  screenshot() {
    if (this.busy || this.options.getImages().length >= 8) return;
    // Request screen access within the click's activation, before lazy import.
    void this.edit(
      requestCapture(this.lifetime.signal).then((stream) => ({ stream })),
      'capture',
    );
  }

  private async edit(
    source: Promise<{ blob: Blob } | { stream: MediaStream }>,
    kind: 'capture' | 'import',
    replaceId?: string,
  ) {
    this.busy = true;
    this.options.changed();
    let input: Awaited<typeof source> | undefined;
    const { signal } = this.lifetime;
    try {
      input = await source;
      signal.throwIfAborted();
      const { createDrawingEditor } = await import('../../../packages/sdk/src/ui/drawing');
      signal.throwIfAborted();
      await createDrawingEditor({
        source: input,
        theme: this.options.theme(),
        i18n: this.i18n,
        signal,
        onSave: async (blob) => {
          const metadata = await describeImage(blob, kind === 'capture' ? 'screen' : 'import');
          signal.throwIfAborted();
          const url = URL.createObjectURL(blob);
          this.urls.set(metadata.id, url);
          const image = { metadata, blob, url };
          const images = this.options.getImages();
          this.options.setImages(
            replaceId
              ? images.map((current) => (current.metadata.id === replaceId ? image : current))
              : [...images, image],
          );
        },
        onClose: () => {
          this.busy = false;
          if (!signal.aborted) this.options.changed();
        },
      });
    } catch (error) {
      if (input && 'stream' in input) input.stream.getTracks().forEach((track) => track.stop());
      this.busy = false;
      if (!signal.aborted) {
        this.options.message(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? '未开启屏幕共享，可以重试截图或选择已有图片。'
            : formatMessage('zh-Hans', errorMessage(error, 'imageAttachFailed')),
        );
        this.options.changed();
      }
    }
  }

  retain(images: PrototypeImage[]) {
    const keep = new Set(images.map((image) => image.metadata.id));
    for (const [id, url] of this.urls) {
      if (keep.has(id)) continue;
      URL.revokeObjectURL(url);
      this.urls.delete(id);
    }
  }

  destroy() {
    this.lifetime.abort();
    this.retain([]);
  }
}
