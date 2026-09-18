import type { InspectorPosition } from '../core/types';

export const TRIGGER_SIZE = 48;
export const TOOLBAR_WIDTH = 294;
export const TOOLBAR_HEIGHT = 52;
type Point = { left: number; top: number };
type Size = { width: number; height: number };
export type Viewport = Point & Size;

export function getViewport(): Viewport {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? document.documentElement.clientWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

export function clampPoint(point: Point, size: Size, viewport: Viewport): Point {
  return {
    left: Math.max(
      viewport.left,
      Math.min(point.left, viewport.left + viewport.width - size.width),
    ),
    top: Math.max(viewport.top, Math.min(point.top, viewport.top + viewport.height - size.height)),
  };
}

export function triggerAnchor(
  rect: Point & Size,
  expanded: boolean,
  opensLeft: boolean,
): InspectorPosition {
  return {
    left: rect.left + (expanded && opensLeft ? rect.width - TRIGGER_SIZE : 0),
    top: rect.top + (expanded ? rect.height - TRIGGER_SIZE : 0),
    opensLeft,
  };
}

export function positionFromAnchor(
  anchor: InspectorPosition,
  size: Size,
  expanded: boolean,
): Point {
  return {
    left: anchor.left - (expanded && anchor.opensLeft ? size.width - TRIGGER_SIZE : 0),
    top: anchor.top - (expanded ? size.height - TRIGGER_SIZE : 0),
  };
}

export function expandToolbar(
  trigger: Point & Size,
  opensLeft: boolean,
  viewport: Viewport,
): { point: Point; opensLeft: boolean } {
  const width = Math.min(TOOLBAR_WIDTH, Math.max(0, viewport.width - 32));
  const fitsLeft = trigger.left + trigger.width - width >= viewport.left;
  const fitsRight = trigger.left + width <= viewport.left + viewport.width;
  if (opensLeft && !fitsLeft) opensLeft = false;
  else if (!opensLeft && !fitsRight) opensLeft = true;
  return {
    point: {
      left: opensLeft ? trigger.left + trigger.width - width : trigger.left,
      top: trigger.top + trigger.height - TOOLBAR_HEIGHT,
    },
    opensLeft,
  };
}
