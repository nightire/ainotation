import { expect, it } from 'vite-plus/test';
import { clampPoint, expandToolbar, positionFromAnchor, triggerAnchor } from './position';

it('round-trips shared anchors on either side without changing their edge', () => {
  for (const opensLeft of [false, true]) {
    const anchor = { left: 400, top: 200, opensLeft };
    const size = { width: 254, height: 52 };
    const point = positionFromAnchor(anchor, size, true);
    expect(triggerAnchor({ ...point, ...size }, true, opensLeft)).toEqual(anchor);
  }
});

it('keeps a preferred edge when it fits and respects offset or tiny viewports', () => {
  const viewport = { left: 20, top: 30, width: 1000, height: 600 };
  const trigger = { left: 400, top: 200, width: 48, height: 48 };
  expect(expandToolbar(trigger, false, viewport)).toEqual({
    point: { left: 400, top: 196 },
    opensLeft: false,
  });
  expect(expandToolbar({ ...trigger, left: 20 }, true, viewport).opensLeft).toBe(false);
  expect(expandToolbar({ ...trigger, left: 970 }, false, viewport).opensLeft).toBe(true);
  expect(clampPoint({ left: -100, top: 1000 }, { width: 48, height: 48 }, viewport)).toEqual({
    left: 20,
    top: 582,
  });
  expect(
    clampPoint(
      { left: 100, top: 100 },
      { width: 254, height: 52 },
      { left: 0, top: 0, width: 200, height: 40 },
    ),
  ).toEqual({ left: 0, top: 0 });
});
