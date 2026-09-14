import { expect, it } from 'vite-plus/test';
import { cropPixels, normalizedCrop } from './crop';
import { imageCanvas, canvasBlob, describeImage } from './images';

it('maps document-space crops to real capture pixels including scroll and DPR', () => {
  const crop = normalizedCrop(
    { left: 150, top: 360, right: 350, bottom: 480 },
    { left: 50, top: 300, right: 850, bottom: 900 },
  );
  expect(cropPixels(crop, 1600, 1200)).toEqual({ x: 200, y: 120, width: 400, height: 240 });
  expect(cropPixels({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 1000, 1000)).toEqual({
    x: 100,
    y: 100,
    width: 200,
    height: 200,
  });
  expect(() =>
    normalizedCrop(
      { left: 1000, top: 0, right: 1200, bottom: 100 },
      { left: 0, top: 0, right: 800, bottom: 600 },
    ),
  ).toThrow('outside');
});

it('clips partial crops to the frame and rejects empty or invalid areas', () => {
  expect(cropPixels({ x: -0.1, y: 0.5, width: 0.4, height: 0.7 }, 100, 100)).toEqual({
    x: 0,
    y: 50,
    width: 30,
    height: 50,
  });
  expect(() => cropPixels({ x: 2, y: 0, width: 0.1, height: 0.1 }, 100, 100)).toThrow('outside');
  expect(() => cropPixels({ x: 0, y: 0, width: 0, height: 1 }, 100, 100)).toThrow('Invalid');
});

it('crops before downscaling so a small region of a 6K source keeps its detail', async () => {
  const source = document.createElement('canvas');
  source.width = 6016;
  source.height = 3384;
  const context = source.getContext('2d')!;
  context.fillStyle = 'red';
  context.fillRect(0, 0, source.width, source.height);
  context.fillStyle = '#22c55e';
  context.fillRect(100, 100, 320, 180);
  const crop = imageCanvas(source, source.width, source.height, {
    x: 100 / source.width,
    y: 100 / source.height,
    width: 320 / source.width,
    height: 180 / source.height,
  });
  try {
    expect(crop.width).toBe(320);
    expect(crop.height).toBe(180);
    expect([...crop.getContext('2d')!.getImageData(160, 90, 1, 1).data]).toEqual([
      34, 197, 94, 255,
    ]);
    expect(await describeImage(await canvasBlob(crop), 'screen')).toMatchObject({
      width: 320,
      height: 180,
    });
  } finally {
    source.width = 0;
    crop.width = 0;
  }
});
