import { expect, it } from 'vite-plus/test';
import {
  canvasBlob,
  describeImage,
  verifyImage,
  decodeImage,
  fittedImageSize,
  checkImageSize,
} from './images';
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from '@ainotation/schema';
import { imageArchive } from './image-archive';
import { requestCapture, createScreenCapture } from './capture';
import { vi } from 'vite-plus/test';

it('normalizes image metadata, detects corrupt bytes and rejects unsupported input', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 12;
  const blob = await canvasBlob(canvas);
  const image = await describeImage(blob, 'import');
  expect(image).toMatchObject({
    width: 24,
    height: 12,
    size: blob.size,
    mimeType: 'image/png',
    source: 'import',
  });
  await verifyImage(blob, image);
  await expect(verifyImage(new Blob(['invalid'], { type: 'image/png' }), image)).rejects.toThrow(
    'validation',
  );
  await expect(decodeImage(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).rejects.toThrow('PNG');
});

it('distinguishes invalid frames and fits large or wide captures without enlarging ordinary images', () => {
  expect(() => checkImageSize(0, 900)).toThrow('invalid dimensions (0 × 900)');
  expect(() => checkImageSize(6016, 3384)).toThrow('6016 × 3384');
  expect(fittedImageSize(1280, 900)).toEqual({ width: 1280, height: 900 });
  for (const [width, height] of [
    [6016, 3384],
    [8000, 8000],
    [20000, 1000],
    [1000, 20000],
  ]) {
    const result = fittedImageSize(width!, height!);
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(16384);
    expect(Math.abs(result.width / result.height - width! / height!)).toBeLessThan(0.01);
  }
});

it('reduces a complex generated PNG to the byte limit while preserving the original canvas', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1536;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(canvas.width, canvas.height);
  let random = 12345;
  for (let i = 0; i < pixels.data.length; i += 4) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    pixels.data[i] = random & 255;
    pixels.data[i + 1] = (random >>> 8) & 255;
    pixels.data[i + 2] = (random >>> 16) & 255;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  try {
    const original = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), 'image/png'),
    );
    expect(original.size).toBeGreaterThan(MAX_IMAGE_BYTES);
    const blob = await canvasBlob(canvas);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    const image = await describeImage(blob, 'screen');
    expect(image.width).toBeLessThan(2048);
    expect(image.height).toBeLessThan(1536);
    expect(image.width / image.height).toBeCloseTo(4 / 3, 2);
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(1536);
    const aborted = new AbortController();
    aborted.abort();
    await expect(canvasBlob(canvas, aborted.signal)).rejects.toThrow();
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}, 15000);

it('automatically fits a 6K capture frame to attachment dimensions', async () => {
  const videoCanvas = document.createElement('canvas');
  videoCanvas.width = 80;
  videoCanvas.height = 40;
  videoCanvas.getContext('2d')!.fillRect(0, 0, 80, 40);
  const stream = videoCanvas.captureStream(30);
  const source = document.createElement('canvas');
  source.width = 6016;
  source.height = 3384;
  const context = source.getContext('2d')!;
  context.fillStyle = '#22c55e';
  context.fillRect(0, 0, source.width, source.height);
  const lifetime = new AbortController();
  vi.stubGlobal(
    'ImageCapture',
    class {
      async grabFrame() {
        return createImageBitmap(source);
      }
    },
  );
  try {
    const capture = await createScreenCapture(stream, lifetime.signal);
    const result = await capture.snapshot();
    expect(result.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    const image = await describeImage(result, 'screen');
    expect(image).toMatchObject(fittedImageSize(source.width, source.height));
    expect(image.width * image.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    const bitmap = await decodeImage(result);
    try {
      const sample = document.createElement('canvas');
      sample.width = 1;
      sample.height = 1;
      const pixels = sample.getContext('2d')!;
      pixels.drawImage(bitmap, 0, 0, 1, 1);
      expect([...pixels.getImageData(0, 0, 1, 1).data]).toEqual([34, 197, 94, 255]);
    } finally {
      bitmap.close();
    }
  } finally {
    lifetime.abort();
    source.width = 0;
    source.height = 0;
    vi.unstubAllGlobals();
  }
}, 15000);

it('writes ZIP headers, directory offsets, CRC and original attachment bytes', async () => {
  const zip = await imageArchive([
    { name: 'image.png', blob: new Blob(['123456789']) },
    { name: 'feedback.json', blob: new Blob(['{}']) },
  ]);
  const bytes = await zip.arrayBuffer();
  const view = new DataView(bytes);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint32(14, true)).toBe(0xcbf43926);
  expect(new TextDecoder().decode(bytes.slice(30 + 9, 30 + 9 + 9))).toBe('123456789');
  const end = bytes.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(2);
  const directory = view.getUint32(end + 16, true);
  expect(view.getUint32(directory, true)).toBe(0x02014b50);
  expect(view.getUint32(directory + 42, true)).toBe(0);
  expect(directory + view.getUint32(end + 12, true)).toBe(end);
});

it('stops authorization delivered after screenshot cancellation', async () => {
  const canvas = document.createElement('canvas');
  const stream = canvas.captureStream();
  let authorize!: (value: MediaStream) => void;
  const original = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockImplementation(
    () =>
      new Promise((resolve) => {
        authorize = resolve;
      }),
  );
  const controller = new AbortController();
  try {
    const pending = requestCapture(controller.signal);
    controller.abort();
    authorize(stream);
    await expect(pending).rejects.toThrow();
    expect(stream.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
  } finally {
    original.mockRestore();
    stream.getTracks().forEach((track) => track.stop());
  }
});

it('waits for a freshly captured tab frame instead of returning a queued frame after 200ms', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 40;
  canvas.getContext('2d')!.fillRect(0, 0, 80, 40);
  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0]!;
  const settings = track.getSettings();
  vi.spyOn(track, 'getSettings').mockReturnValue({ ...settings, displaySurface: 'browser' });
  let receive: VideoFrameRequestCallback | undefined;
  vi.spyOn(HTMLVideoElement.prototype, 'requestVideoFrameCallback').mockImplementation(
    (callback) => {
      receive = callback;
      return 1;
    },
  );
  vi.spyOn(HTMLVideoElement.prototype, 'cancelVideoFrameCallback').mockImplementation(() => {});
  vi.stubGlobal('ImageCapture', undefined);
  const lifetime = new AbortController();
  let pending: Promise<Blob> | undefined;
  let finished = false;
  try {
    const capture = await createScreenCapture(stream, lifetime.signal);
    pending = capture.snapshot().then((blob) => {
      finished = true;
      return blob;
    });
    await vi.waitFor(() => expect(receive).toBeTypeOf('function'), { timeout: 5000 });
    const metadata = {
      captureTime: 0,
      expectedDisplayTime: 0,
      height: 40,
      mediaTime: 0,
      presentationTime: 0,
      presentedFrames: 1,
      width: 80,
    };
    receive!(performance.now(), metadata);
    // Exceed the static-video fallback while the tab's fresh frame is still delayed.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(finished).toBe(false);
    receive!(performance.now(), { ...metadata, captureTime: performance.now() });
    expect(await describeImage(await pending, 'screen')).toMatchObject({ width: 80, height: 40 });
  } finally {
    lifetime.abort();
    await pending?.catch(() => {});
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it.each(['unavailable', 'failed'] as const)(
  'captures a static video frame when ImageCapture is %s and stops the stream on teardown',
  async (mode) => {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 40;
    canvas.getContext('2d')!.fillRect(0, 0, 80, 40);
    const stream = canvas.captureStream(30);
    const lifetime = new AbortController();
    vi.stubGlobal(
      'ImageCapture',
      mode === 'unavailable'
        ? undefined
        : class {
            grabFrame() {
              return Promise.reject(new Event('error'));
            }
          },
    );
    try {
      const capture = await createScreenCapture(stream, lifetime.signal);
      const blob = await capture.snapshot();
      expect(await describeImage(blob, 'screen')).toMatchObject({ width: 80, height: 40 });
      await expect(capture.snapshot({ x: 0, y: 0, width: 0.5, height: 0.5 })).rejects.toThrow(
        'current browser tab',
      );
      lifetime.abort();
      expect(stream.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
      await expect(capture.snapshot()).rejects.toThrow('ended');
    } finally {
      lifetime.abort();
      vi.unstubAllGlobals();
    }
  },
);
