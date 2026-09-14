import { expect, it } from 'vite-plus/test';
import {
  moveShape,
  resizeShape,
  rotateShape,
  rotatePoint,
  shapeBounds,
  selectionBox,
  shapeWorldBounds,
  shapesInBox,
  type Shape,
} from './drawing-geometry';

it('moves the arrow tail without moving its tip', () => {
  const arrow: Shape = {
    tool: 'arrow',
    color: 'red',
    points: [
      { x: 10, y: 20 },
      { x: 90, y: 80 },
    ],
  };
  const resized = resizeShape(arrow, { x: 12, y: 23 }, { x: 40, y: 50 }, 2);
  expect(resized.points).toEqual([
    { x: 38, y: 47 },
    { x: 90, y: 80 },
  ]);
  expect(arrow.points[0]).toEqual({ x: 10, y: 20 });
});

it('selects rotated and thin shapes using their visible bounds with forward or reverse boxes', () => {
  const shapes: Shape[] = [
    {
      tool: 'rectangle',
      color: 'red',
      rotation: Math.PI / 2,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 20 },
      ],
    },
    {
      tool: 'ellipse',
      color: 'red',
      rotation: Math.PI / 2,
      points: [
        { x: 200, y: 0 },
        { x: 300, y: 20 },
      ],
    },
    {
      tool: 'arrow',
      color: 'red',
      points: [
        { x: 400, y: 20 },
        { x: 500, y: 20 },
      ],
    },
    {
      tool: 'pen',
      color: 'red',
      points: [
        { x: 550, y: 0 },
        { x: 560, y: 50 },
        { x: 570, y: 0 },
      ],
    },
  ];
  expect(shapeWorldBounds(shapes[0]!)).toEqual({
    left: 38.5,
    right: 61.5,
    top: -41.5,
    bottom: 61.5,
  });
  const box = selectionBox({ x: 30, y: -50 }, { x: 270, y: 70 });
  expect(shapesInBox(shapes, box)).toEqual([0, 1]);
  expect(shapesInBox(shapes, selectionBox({ x: 270, y: 70 }, { x: 30, y: -50 }))).toEqual([0, 1]);
  expect(shapesInBox(shapes, selectionBox({ x: 400, y: 19 }, { x: 600, y: 21 }))).toEqual([2, 3]);
  expect(shapeWorldBounds(shapes[2]!).top).toBeLessThan(19);
  expect(shapesInBox(shapes, selectionBox({ x: 700, y: 700 }, { x: 710, y: 710 }))).toEqual([]);
});

it('resizes rotated shapes along their own axes with the opposite corner fixed', () => {
  for (const tool of ['rectangle', 'ellipse', 'pen'] as const) {
    const shape: Shape = {
      tool,
      color: 'red',
      rotation: Math.PI / 3,
      points: [
        { x: 80, y: 60 },
        { x: 10, y: 20 },
        { x: 35, y: 40 },
      ],
    };
    const before = shapeBounds(shape);
    const anchor = rotatePoint({ x: before.left, y: before.top }, before.center, shape.rotation!);
    const handle = rotatePoint(
      { x: before.right, y: before.bottom },
      before.center,
      shape.rotation!,
    );
    const delta = rotatePoint({ x: 35, y: 20 }, { x: 0, y: 0 }, shape.rotation!);
    const result = resizeShape(shape, handle, { x: handle.x + delta.x, y: handle.y + delta.y }, 2);
    const after = shapeBounds(result);
    expect(after.width).toBeCloseTo(105);
    expect(after.height).toBeCloseTo(60);
    const fixed = rotatePoint({ x: after.left, y: after.top }, after.center, result.rotation!);
    expect(fixed.x).toBeCloseTo(anchor.x);
    expect(fixed.y).toBeCloseTo(anchor.y);
  }
});

it('rotates about the center and translates without changing geometry or orientation', () => {
  const shape: Shape = {
    tool: 'rectangle',
    color: 'red',
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 40 },
    ],
  };
  const rotated = rotateShape(shape, { x: 80, y: 40 }, { x: 20, y: 60 });
  expect(rotated.rotation).toBeCloseTo(Math.PI / 2);
  const moved = moveShape(rotated, { x: 13, y: -7 });
  expect(shapeBounds(moved).center).toEqual({ x: 53, y: 13 });
  expect(moved.rotation).toBe(rotated.rotation);
});

it('keeps flat and tiny pen strokes finite during repeated resizing', () => {
  const shape: Shape = {
    tool: 'pen',
    color: 'red',
    points: [
      { x: 10, y: 20 },
      { x: 100, y: 20 },
      { x: 50, y: 20 },
    ],
  };
  const resized = resizeShape(shape, { x: 100, y: 20 }, { x: -100, y: -100 }, 2);
  expect(shapeBounds(resized).width).toBe(2);
  expect(shapeBounds(resized).height).toBe(0);
  expect(resized.points.flatMap((point) => [point.x, point.y]).every(Number.isFinite)).toBe(true);
});
