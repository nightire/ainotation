export type Point = { x: number; y: number };
export type Shape = {
  tool: 'arrow' | 'rectangle' | 'ellipse' | 'pen';
  color: string;
  strokeWidth?: number;
  points: Point[];
  rotation?: number;
};

export function shapeBounds(shape: Shape) {
  const xs = shape.points.map((point) => point.x);
  const ys = shape.points.map((point) => point.y);
  const left = Math.min(...xs),
    top = Math.min(...ys);
  const right = Math.max(...xs),
    bottom = Math.max(...ys);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    center: { x: (left + right) / 2, y: (top + bottom) / 2 },
  };
}

export function rotatePoint(point: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const x = point.x - center.x,
    y = point.y - center.y;
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
}

export function moveShape(shape: Shape, delta: Point): Shape {
  return {
    ...shape,
    points: shape.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
  };
}

/** Resize in the shape's own axes, preserving the opposite corner in page space. */
export function resizeShape(shape: Shape, start: Point, current: Point, minimum: number): Shape {
  if (shape.tool === 'arrow')
    return {
      ...shape,
      points: [
        {
          x: shape.points[0]!.x + current.x - start.x,
          y: shape.points[0]!.y + current.y - start.y,
        },
        shape.points[1]!,
      ],
    };
  const bounds = shapeBounds(shape);
  const angle = shape.rotation ?? 0;
  const delta = rotatePoint(
    { x: current.x - start.x, y: current.y - start.y },
    { x: 0, y: 0 },
    -angle,
  );
  const width = Math.max(minimum, bounds.width + delta.x);
  const height = Math.max(minimum, bounds.height + delta.y);
  // A perfectly flat stroke has no extent to scale along that axis.
  const scaled: Shape = {
    ...shape,
    points: shape.points.map((point) => ({
      x: bounds.left + (bounds.width ? ((point.x - bounds.left) * width) / bounds.width : 0),
      y: bounds.top + (bounds.height ? ((point.y - bounds.top) * height) / bounds.height : 0),
    })),
  };
  const anchor = { x: bounds.left, y: bounds.top };
  const fixed = rotatePoint(anchor, bounds.center, angle);
  const moved = rotatePoint(anchor, shapeBounds(scaled).center, angle);
  return moveShape(scaled, { x: fixed.x - moved.x, y: fixed.y - moved.y });
}

export function rotateShape(shape: Shape, start: Point, current: Point): Shape {
  const { center } = shapeBounds(shape);
  const delta =
    Math.atan2(current.y - center.y, current.x - center.x) -
    Math.atan2(start.y - center.y, start.x - center.x);
  return { ...shape, rotation: (shape.rotation ?? 0) + delta };
}

export type SelectionBox = { left: number; top: number; right: number; bottom: number };

export function selectionBox(start: Point, end: Point): SelectionBox {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

/** Bounds in the drawing's coordinates, after rotation, including visible strokes. */
export function shapeWorldBounds(shape: Shape): SelectionBox {
  const bounds = shapeBounds(shape);
  const angle = shape.rotation ?? 0;
  const padding = (shape.strokeWidth ?? 3) / 2;
  if (shape.tool === 'ellipse') {
    const x =
      Math.hypot((bounds.width / 2) * Math.cos(angle), (bounds.height / 2) * Math.sin(angle)) +
      padding;
    const y =
      Math.hypot((bounds.width / 2) * Math.sin(angle), (bounds.height / 2) * Math.cos(angle)) +
      padding;
    return {
      left: bounds.center.x - x,
      right: bounds.center.x + x,
      top: bounds.center.y - y,
      bottom: bounds.center.y + y,
    };
  }
  let points = shape.points;
  if (shape.tool === 'rectangle')
    points = [
      { x: bounds.left, y: bounds.top },
      { x: bounds.right, y: bounds.top },
      { x: bounds.right, y: bounds.bottom },
      { x: bounds.left, y: bounds.bottom },
    ];
  else if (shape.tool === 'arrow') {
    const start = shape.points[0]!,
      end = shape.points.at(-1)!;
    const direction = Math.atan2(end.y - start.y, end.x - start.x);
    points = [
      ...points,
      ...[-0.45, 0.45].map((offset) => ({
        x: end.x - 14 * Math.cos(direction + offset),
        y: end.y - 14 * Math.sin(direction + offset),
      })),
    ];
  }
  const transformed = points.map((point) => rotatePoint(point, bounds.center, angle));
  return {
    left: Math.min(...transformed.map((point) => point.x)) - padding,
    right: Math.max(...transformed.map((point) => point.x)) + padding,
    top: Math.min(...transformed.map((point) => point.y)) - padding,
    bottom: Math.max(...transformed.map((point) => point.y)) + padding,
  };
}

export function shapesInBox(shapes: Shape[], box: SelectionBox): number[] {
  return shapes.flatMap((shape, index) => {
    const bounds = shapeWorldBounds(shape);
    return bounds.right >= box.left &&
      bounds.left <= box.right &&
      bounds.bottom >= box.top &&
      bounds.top <= box.bottom
      ? [index]
      : [];
  });
}
