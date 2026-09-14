import type { SelectionBox } from './drawing-geometry';
import { uiError } from '../i18n';

export type ImageCrop = { x: number; y: number; width: number; height: number };

export function intersectCrop(crop: SelectionBox, bounds: SelectionBox): SelectionBox | null {
  const result = {
    left: Math.max(crop.left, bounds.left),
    top: Math.max(crop.top, bounds.top),
    right: Math.min(crop.right, bounds.right),
    bottom: Math.min(crop.bottom, bounds.bottom),
  };
  return result.right > result.left && result.bottom > result.top ? result : null;
}

/** Store normalized viewport/image coordinates, independently of capture resolution. */
export function normalizedCrop(crop: SelectionBox, bounds: SelectionBox): ImageCrop {
  const clipped = intersectCrop(crop, bounds);
  if (!clipped) throw uiError('cropOutside');
  return {
    x: (clipped.left - bounds.left) / (bounds.right - bounds.left),
    y: (clipped.top - bounds.top) / (bounds.bottom - bounds.top),
    width: (clipped.right - clipped.left) / (bounds.right - bounds.left),
    height: (clipped.bottom - clipped.top) / (bounds.bottom - bounds.top),
  };
}

export function cropPixels(crop: ImageCrop, width: number, height: number): ImageCrop {
  if (
    ![crop.x, crop.y, crop.width, crop.height, width, height].every(Number.isFinite) ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    width <= 0 ||
    height <= 0
  )
    throw uiError('cropInvalid');
  const snap = (value: number) =>
    Math.abs(value - Math.round(value)) < 1e-7 ? Math.round(value) : value;
  const left = Math.max(0, Math.floor(snap(crop.x * width))),
    top = Math.max(0, Math.floor(snap(crop.y * height)));
  const right = Math.min(width, Math.ceil(snap((crop.x + crop.width) * width))),
    bottom = Math.min(height, Math.ceil(snap((crop.y + crop.height) * height)));
  if (right <= left || bottom <= top) throw uiError('cropOutsideImage');
  return { x: left, y: top, width: right - left, height: bottom - top };
}
