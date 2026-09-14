import { html, svg, render, nothing } from 'lit';
import {
  ArrowUpRight,
  Square,
  Circle,
  ChevronDown,
  Crop,
  Pencil,
  MousePointer2,
  Undo2,
  Redo2,
  Trash2,
  Check,
  X,
  createElement,
} from 'lucide';
import type { InspectorTheme } from '../core/types';
import { decodeImage } from '../core/images';
import { composeImage } from '../core/compose-image';
import { intersectCrop, normalizedCrop } from '../core/crop';
import { createScreenCapture } from '../core/capture';
import { drawingStyles } from './drawing-styles';
import { createDrawingLayer } from './drawing-layer';
import { bindDrawingPointerEvents } from './drawing-input';
import {
  shapeBounds,
  moveShape,
  resizeShape,
  rotateShape,
  selectionBox,
  shapeWorldBounds,
  shapesInBox,
  type Point,
  type Shape,
  type SelectionBox,
} from '../core/drawing-geometry';

type Tool = 'select' | 'arrow' | 'rectangle' | 'ellipse' | 'pen' | 'crop';
type GestureMode =
  | 'draw'
  | 'move'
  | 'resize'
  | 'rotate'
  | 'marquee'
  | 'crop-new'
  | 'crop-move'
  | 'crop-resize';
type DrawingState = { shapes: Shape[]; selected: number[]; crop: SelectionBox | null };
const tools = {
  select: MousePointer2,
  arrow: ArrowUpRight,
  rectangle: Square,
  ellipse: Circle,
  pen: Pencil,
  crop: Crop,
};
const colors = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#111827'];
const strokeWidths = [0.5, 1, 1.5, 2, 3, 4, 5];
const toolKeys: Record<Tool, string> = {
  select: 'v',
  arrow: 'a',
  rectangle: 'r',
  ellipse: 'e',
  pen: 'f',
  crop: 'x',
};
const toolLabels: Record<Tool, string> = {
  select: 'Select / move',
  arrow: 'Arrow',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  pen: 'Free draw',
  crop: 'Crop',
};
const colorLabels = ['Red', 'Amber', 'Green', 'Blue', 'White', 'Black'];
const icon = (value: typeof Check) =>
  createElement(value, { width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' });

function rotationCursor(angle: number) {
  const degrees = Math.round((((angle * 180) / Math.PI + 90) % 360) * 10) / 10;
  // Orient the arc for the bottom-right handle; padding prevents clipping
  // as it rotates within the fixed 20px cursor canvas.
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="-6 -6 40 40"><g transform="rotate(${degrees} 14 14)" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7C18 6 22 12 21 23M11 2L5 7L10 13M15 18L21 23L26 17" stroke="white" stroke-width="5"/><path d="M5 7C18 6 22 12 21 23M11 2L5 7L10 13M15 18L21 23L26 17" stroke="black" stroke-width="3"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(image)}") 10 10, crosshair`;
}

export async function createDrawingEditor(options: {
  source: { stream: MediaStream } | { blob: Blob };
  theme: InspectorTheme;
  signal: AbortSignal;
  onSave: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, lifetime.signal]);
  const source = options.source;
  const capture = 'stream' in source ? await createScreenCapture(source.stream, signal) : null;
  const bitmap = 'blob' in source ? await decodeImage(source.blob) : null;
  if (signal.aborted) {
    capture?.stop();
    bitmap?.close();
    signal.throwIfAborted();
  }
  const imageUrl = 'blob' in source ? URL.createObjectURL(source.blob) : null;
  let layer: ReturnType<typeof createDrawingLayer>;
  try {
    layer = createDrawingLayer(options.theme, signal);
  } catch (error) {
    lifetime.abort();
    capture?.stop();
    bitmap?.close();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    throw error;
  }
  const { host, shadow, raise } = layer;
  let tool: Tool = 'arrow';
  let color = colors[0]!;
  type Palette = 'color' | 'width';
  let openPalette: Palette | null = null;
  let paletteIndex = 0;
  let paletteKeyboard = false;
  const primaryIndex = () => [...selected].at(-1) ?? -1;
  const activeColor = () => shapes[primaryIndex()]?.color ?? color;
  const activeWidth = () => shapes[primaryIndex()]?.strokeWidth ?? strokeWidth;
  function closePalette(restoreFocus = false) {
    if (!openPalette) return;
    const previous = openPalette;
    const focused = !!shadow.activeElement?.closest('.palette');
    openPalette = null;
    paint();
    if (restoreFocus && (paletteKeyboard || focused))
      shadow
        .querySelector<HTMLButtonElement>(`[data-action="${previous}-palette"]`)
        ?.focus({ preventScroll: true });
  }
  function togglePalette(value: Palette, keyboard: boolean) {
    if (openPalette === value) {
      closePalette(keyboard);
      return;
    }
    openPalette = value;
    paletteKeyboard = keyboard;
    paletteIndex =
      value === 'color' ? colors.indexOf(activeColor()) : strokeWidths.indexOf(activeWidth());
    showTooltip(null);
    paint();
    if (keyboard) paletteButtons()[paletteIndex]?.focus({ preventScroll: true });
  }
  const paletteButtons = () => [...shadow.querySelectorAll<HTMLButtonElement>('.palette button')];
  function positionPalette() {
    const palette = shadow.querySelector<HTMLElement>('.palette');
    const trigger = shadow.querySelector<HTMLElement>(`[data-action="${openPalette}-palette"]`);
    if (!palette || !trigger) return;
    const anchor = trigger.getBoundingClientRect();
    const size = palette.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth;
    palette.style.left = `${Math.max(left + 8, Math.min(anchor.x + anchor.width / 2 - size.width / 2, left + width - size.width - 8))}px`;
    palette.style.top = `${Math.max(top + 8, anchor.top - size.height - 8)}px`;
  }
  let strokeWidth = 3;
  let shapes: Shape[] = [];
  const undo: DrawingState[] = [];
  const redo: DrawingState[] = [];
  let selected = new Set<number>();
  let crop: SelectionBox | null = null;
  const drawingBounds = (): SelectionBox =>
    bitmap
      ? { left: 0, top: 0, right: bitmap.width, bottom: bitmap.height }
      : { left: scrollX, top: scrollY, right: scrollX + innerWidth, bottom: scrollY + innerHeight };
  let gesture: {
    pointer: number;
    start: Point;
    before: Shape[];
    beforeSelected: number[];
    beforeCrop: SelectionBox | null;
    current: Point;
    additive: boolean;
    index: number;
    mode: GestureMode;
  } | null = null;
  let alt = false;
  const passed = new Set<number>();
  let busy = false;
  let closed = false;
  let notice = '';
  let tooltipTarget: HTMLElement | null = null;
  function showTooltip(target: HTMLElement | null) {
    if (
      busy ||
      closed ||
      passthrough() ||
      !target?.isConnected ||
      (openPalette !== null && target.dataset.action === `${openPalette}-palette`)
    )
      target = null;
    if (tooltipTarget !== target) tooltipTarget?.removeAttribute('aria-describedby');
    tooltipTarget = target;
    const tooltip = shadow.querySelector<HTMLElement>('#ainotation-drawing-tooltip');
    if (!tooltip) return;
    tooltip.hidden = !target;
    if (!target) return;
    target.setAttribute('aria-describedby', 'ainotation-drawing-tooltip');
    tooltip.textContent = target.dataset.tooltip ?? '';
    const anchor = target.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth,
      height = viewport?.height ?? innerHeight;
    tooltip.style.maxWidth = `${Math.max(0, width - 16)}px`;
    const size = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(left + 8, Math.min(anchor.x + anchor.width / 2 - size.width / 2, left + width - size.width - 8))}px`;
    tooltip.style.top = `${Math.max(top + 8, Math.min(anchor.top - size.height - 8 >= top + 8 ? anchor.top - size.height - 8 : anchor.bottom + 8, top + height - size.height - 8))}px`;
  }
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  const passthrough = () => !!capture && (alt || passed.size > 0);
  const remember = (before: Shape[], beforeSelected = [...selected], beforeCrop = crop) => {
    undo.push({
      shapes: before,
      selected: beforeSelected,
      crop: beforeCrop ? { ...beforeCrop } : null,
    });
    if (undo.length > 100) undo.shift();
    redo.length = 0;
  };
  const point = (event: PointerEvent): Point => {
    const matrix = shadow.querySelector<SVGSVGElement>('.drawing-surface')?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: position.x, y: position.y };
  };
  const pixelUnit = () => {
    const matrix = shadow.querySelector<SVGSVGElement>('.drawing-surface')?.getScreenCTM();
    return matrix ? 1 / Math.max(0.0001, Math.hypot(matrix.a, matrix.b)) : 1;
  };
  const shapeTransform = (shape: Shape) => {
    const { center } = shapeBounds(shape);
    return `rotate(${((shape.rotation ?? 0) * 180) / Math.PI} ${center.x} ${center.y})`;
  };
  function cancelGesture() {
    if (gesture) {
      shapes = gesture.before;
      selected = new Set(gesture.beforeSelected);
      crop = gesture.beforeCrop;
      const surface = shadow.querySelector<SVGSVGElement>('.drawing-surface');
      if (surface?.hasPointerCapture(gesture.pointer))
        surface.releasePointerCapture(gesture.pointer);
    }
    gesture = null;
  }
  function drawPointerDown(event: PointerEvent, target: Element, surface: SVGSVGElement) {
    if (busy || event.button !== 0 || gesture) return;
    showTooltip(null);
    closePalette();
    const before = structuredClone(shapes);
    const beforeSelected = [...selected];
    const start = point(event);
    const beforeCrop = crop ? { ...crop } : null;
    const control = target.closest('[data-control]')?.getAttribute('data-control');
    const hit = Number(target.closest('[data-shape]')?.getAttribute('data-shape') ?? -1);
    let mode: GestureMode;
    if (tool === 'crop') {
      selected.clear();
      mode =
        crop && target.closest('[data-crop-resize]')
          ? 'crop-resize'
          : crop && target.closest('[data-crop-move]')
            ? 'crop-move'
            : 'crop-new';
    } else if (
      (control === 'resize' || control === 'rotate') &&
      selected.size === 1 &&
      shapes[primaryIndex()]
    )
      mode = control;
    else if (target.closest('[data-group-selection]') && selected.size > 1) mode = 'move';
    else if (hit >= 0) {
      if (event.shiftKey && tool === 'select') {
        if (selected.has(hit)) {
          selected.delete(hit);
          paint();
          return;
        }
        selected.add(hit);
      } else if (!selected.has(hit)) selected = new Set([hit]);
      mode = 'move';
    } else if (tool === 'select') {
      if (!event.shiftKey) selected.clear();
      mode = 'marquee';
    } else {
      if (shapes.length >= 200) {
        notice = 'Up to 200 shapes per image.';
        paint();
        return;
      }
      shapes.push({ tool, color, strokeWidth, points: [start, start] });
      selected = new Set([shapes.length - 1]);
      mode = 'draw';
    }
    gesture = {
      pointer: event.pointerId,
      start,
      current: start,
      before,
      beforeSelected,
      beforeCrop,
      additive: event.shiftKey,
      index: primaryIndex(),
      mode,
    };
    surface.setPointerCapture(event.pointerId);
    paint();
  }
  function drawPointerMove(event: PointerEvent) {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const current = point(event);
    gesture.current = current;
    if (gesture.mode.startsWith('crop-')) {
      const bounds = drawingBounds();
      const clamped = {
        x: Math.max(bounds.left, Math.min(current.x, bounds.right)),
        y: Math.max(bounds.top, Math.min(current.y, bounds.bottom)),
      };
      const original = gesture.beforeCrop;
      if (gesture.mode === 'crop-move' && original) {
        const width = Math.min(original.right - original.left, bounds.right - bounds.left),
          height = Math.min(original.bottom - original.top, bounds.bottom - bounds.top);
        const left = Math.max(
          bounds.left,
          Math.min(original.left + current.x - gesture.start.x, bounds.right - width),
        );
        const top = Math.max(
          bounds.top,
          Math.min(original.top + current.y - gesture.start.y, bounds.bottom - height),
        );
        crop = { left, top, right: left + width, bottom: top + height };
      } else if (gesture.mode === 'crop-resize' && original) {
        crop = intersectCrop(
          {
            ...original,
            right: Math.max(
              original.left + pixelUnit(),
              original.right + clamped.x - gesture.start.x,
            ),
            bottom: Math.max(
              original.top + pixelUnit(),
              original.bottom + clamped.y - gesture.start.y,
            ),
          },
          bounds,
        );
      } else crop = intersectCrop(selectionBox(gesture.start, clamped), bounds);
      paint();
      return;
    }
    if (gesture.mode === 'marquee') {
      const dragging =
        Math.hypot(current.x - gesture.start.x, current.y - gesture.start.y) >= 3 * pixelUnit();
      selected = new Set([
        ...(gesture.additive ? gesture.beforeSelected : []),
        ...(dragging ? shapesInBox(shapes, selectionBox(gesture.start, current)) : []),
      ]);
      paint();
      return;
    }
    const shape = shapes[gesture.index]!;
    const original = gesture.before[gesture.index];
    if (gesture.mode === 'move') {
      for (const index of selected)
        shapes[index] = moveShape(gesture.before[index]!, {
          x: current.x - gesture.start.x,
          y: current.y - gesture.start.y,
        });
    } else if (gesture.mode === 'resize')
      shapes[gesture.index] = resizeShape(original!, gesture.start, current, 2 * pixelUnit());
    else if (gesture.mode === 'rotate')
      shapes[gesture.index] = rotateShape(original!, gesture.start, current);
    else if (shape.tool === 'pen') {
      if (shape.points.length < 2000) shape.points.push(current);
    } else shape.points[1] = current;
    paint();
  }
  function drawPointerUp(event: PointerEvent) {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    if (gesture.mode === 'marquee' || gesture.mode.startsWith('crop-')) drawPointerMove(event);
    if (
      gesture.mode === 'crop-new' &&
      crop &&
      (crop.right - crop.left < 3 * pixelUnit() || crop.bottom - crop.top < 3 * pixelUnit())
    )
      crop = gesture.beforeCrop;
    if (
      JSON.stringify(gesture.before) !== JSON.stringify(shapes) ||
      JSON.stringify(gesture.beforeCrop) !== JSON.stringify(crop)
    )
      remember(gesture.before, gesture.beforeSelected, gesture.beforeCrop);
    gesture = null;
    paint();
  }
  function shapeSvg(shape: Shape, index: number) {
    const first = shape.points[0]!;
    const last = shape.points.at(-1)!;
    const x = Math.min(first.x, last.x),
      y = Math.min(first.y, last.y);
    const width = Math.abs(last.x - first.x),
      height = Math.abs(last.y - first.y);
    const angle = Math.atan2(last.y - first.y, last.x - first.x);
    const tip = (offset: number) =>
      `${last.x - 14 * Math.cos(angle + offset)},${last.y - 14 * Math.sin(angle + offset)}`;
    const geometry =
      shape.tool === 'rectangle'
        ? svg`<rect x=${x} y=${y} width=${width} height=${height}/>`
        : shape.tool === 'ellipse'
          ? svg`<ellipse cx=${x + width / 2} cy=${y + height / 2} rx=${width / 2} ry=${height / 2}/>`
          : shape.tool === 'pen'
            ? svg`<polyline points=${shape.points.map((p) => `${p.x},${p.y}`).join(' ')}/>`
            : svg`<path d=${`M${first.x},${first.y} L${last.x},${last.y} M${tip(-0.45)} L${last.x},${last.y} L${tip(0.45)}`}/>`;
    return svg`<g data-shape=${index} data-selected=${selected.has(index)} transform=${shapeTransform(shape)} stroke=${shape.color} stroke-width=${shape.strokeWidth ?? 3} stroke-linecap="round" stroke-linejoin="round" fill="none" style="pointer-events:stroke;cursor:move">
      ${!busy ? svg`<g stroke="transparent" stroke-width=${12 * pixelUnit()}>${geometry}</g>` : nothing}
      ${geometry}
    </g>`;
  }
  function controlsSvg() {
    if (busy || tool === 'crop' || gesture?.mode === 'marquee') return nothing;
    if (selected.size > 1) {
      const bounds = [...selected].map((index) => shapeWorldBounds(shapes[index]!));
      const unit = pixelUnit(),
        padding = 6 * unit;
      const left = Math.min(...bounds.map((box) => box.left)) - padding;
      const top = Math.min(...bounds.map((box) => box.top)) - padding;
      const right = Math.max(...bounds.map((box) => box.right)) + padding;
      const bottom = Math.max(...bounds.map((box) => box.bottom)) + padding;
      return svg`<rect data-group-selection=${selected.size} x=${left} y=${top} width=${right - left} height=${bottom - top}
        fill="none" stroke="#94a3b8" stroke-width=${unit} stroke-dasharray=${`${4 * unit} ${3 * unit}`} pointer-events="stroke" style="cursor:move"/>`;
    }
    const shape = shapes[primaryIndex()];
    if (!shape || busy) return nothing;
    const bounds = shapeBounds(shape);
    const arrow = shape.tool === 'arrow';
    const handle = arrow ? shape.points[0]! : { x: bounds.right, y: bounds.bottom };
    const unit = pixelUnit();
    const diagonal =
      Math.sin(2 * ((shape.rotation ?? 0) + Math.PI / 4)) >= 0 ? 'nwse-resize' : 'nesw-resize';
    return svg`<g data-controls=${primaryIndex()} transform=${shapeTransform(shape)}>
      ${
        !arrow
          ? svg`<circle data-control="rotate" cx=${handle.x} cy=${handle.y} r=${25 * unit} fill="transparent" pointer-events="all" class="rotate-control"><title>Drag outside the square to rotate</title></circle>`
          : nothing
      }
      <circle data-control="resize" cx=${handle.x} cy=${handle.y} r=${12 * unit} fill="transparent" pointer-events="all" style=${`cursor:${arrow ? 'crosshair' : diagonal}`}><title>${arrow ? 'Drag the tail to change length and direction' : 'Drag to resize'}</title></circle>
      <rect class="control-handle" x=${handle.x - 3 * unit} y=${handle.y - 3 * unit} width=${6 * unit} height=${6 * unit} fill="white" stroke="#94a3b8" stroke-width=${unit} pointer-events="none"/>
    </g>`;
  }
  function marqueeSvg() {
    if (busy || gesture?.mode !== 'marquee') return nothing;
    const box = selectionBox(gesture.start, gesture.current),
      unit = pixelUnit();
    return svg`<rect data-marquee x=${box.left} y=${box.top} width=${box.right - box.left} height=${box.bottom - box.top}
      fill="rgba(59,130,246,.08)" stroke="#60a5fa" stroke-width=${unit} stroke-dasharray=${`${4 * unit} ${3 * unit}`} pointer-events="none"/>`;
  }
  function cropSvg() {
    if (busy || !crop) return nothing;
    const bounds = drawingBounds(),
      box = intersectCrop(crop, bounds);
    if (!box) return nothing;
    const unit = pixelUnit(),
      width = box.right - box.left,
      height = box.bottom - box.top;
    return svg`<g data-crop-guide pointer-events="none">
      <path d=${`M${bounds.left} ${bounds.top}H${bounds.right}V${bounds.bottom}H${bounds.left}Z M${box.left} ${box.top}V${box.bottom}H${box.right}V${box.top}Z`} fill="rgba(0,0,0,.3)" fill-rule="evenodd"/>
      <rect data-crop-area data-crop-move x=${box.left} y=${box.top} width=${width} height=${height} fill="transparent" stroke="white" stroke-width=${unit} stroke-dasharray=${`${5 * unit} ${3 * unit}`} pointer-events=${tool === 'crop' ? 'all' : 'none'} style="cursor:move"/>
      ${
        tool === 'crop'
          ? svg`<rect data-crop-resize x=${box.right - 12 * unit} y=${box.bottom - 12 * unit} width=${24 * unit} height=${24 * unit} fill="transparent" pointer-events="all" style="cursor:nwse-resize"/>
        <rect x=${box.right - 3 * unit} y=${box.bottom - 3 * unit} width=${6 * unit} height=${6 * unit} fill="white" stroke="#94a3b8" stroke-width=${unit}/>`
          : nothing
      }
    </g>`;
  }
  function paint() {
    if (closed) return;
    const pass = passthrough();
    if (busy || pass) openPalette = null;
    const viewBox = bitmap
      ? `0 0 ${bitmap.width} ${bitmap.height}`
      : `${scrollX} ${scrollY} ${innerWidth} ${innerHeight}`;
    render(
      html` <style>
          ${drawingStyles}
        </style>
        <div class="editor" role="region" aria-label="Image annotation editor">
          <div class=${`stage${bitmap ? ' import' : ''}${pass ? ' pass' : ''}`}>
            <div
              class=${bitmap ? 'image-stage' : ''}
              style=${bitmap ? `width:min(${bitmap.width}px,calc((100vh - 130px) * ${bitmap.width / bitmap.height}));aspect-ratio:${bitmap.width}/${bitmap.height}` : ''}
            >
              ${imageUrl ? html`<img src=${imageUrl} alt="Image to annotate" />` : nothing}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class=${`drawing-surface${tool === 'select' ? ' select' : ''}${gesture?.mode === 'rotate' ? ' rotating' : ''}`}
                style=${`--rotation-cursor:${rotationCursor(shapes[primaryIndex()]?.rotation ?? 0)}`}
                viewBox=${viewBox}
                aria-label="Drawing surface"
              >
                ${shapes.map(shapeSvg)} ${controlsSvg()} ${marqueeSvg()} ${cropSvg()}
              </svg>
            </div>
          </div>
          ${notice && !busy ? html`<div class="notice" role="status">${notice}</div>` : nothing}
          <div
            class=${`toolbar${pass ? ' pass' : ''}`}
            role="toolbar"
            aria-label="Drawing tools"
            ?hidden=${busy}
          >
            ${Object.entries(tools).map(
              ([name, symbol]) =>
                html`<button
                  aria-label=${name[0]!.toUpperCase() + name.slice(1)}
                  data-tooltip=${`${toolLabels[name as Tool]} (${toolKeys[name as Tool].toUpperCase()})`}
                  aria-keyshortcuts=${toolKeys[name as Tool]}
                  aria-pressed=${tool === name}
                  data-tool=${name}
                >
                  ${icon(symbol)}
                </button>`,
            )}
            <span class="separator"></span>
            <button
              class="color-trigger"
              aria-label="Color"
              data-tooltip=${`Color: ${colorLabels[colors.indexOf(activeColor())]} (C to cycle)`}
              aria-keyshortcuts="c"
              aria-haspopup="dialog"
              aria-expanded=${openPalette === 'color'}
              aria-controls="ainotation-color-palette"
              data-action="color-palette"
            >
              <span class="swatch" style=${`background:${activeColor()}`} aria-hidden="true"></span>
            </button>
            <span class="separator"></span>
            <button
              class="stroke-width"
              aria-label="Line width"
              data-tooltip="Line width (S to cycle)"
              aria-keyshortcuts="s"
              data-action="width-palette"
              aria-haspopup="listbox"
              aria-expanded=${openPalette === 'width'}
              aria-controls="ainotation-width-palette"
            >
              <span>${activeWidth()} px</span>${icon(ChevronDown)}
            </button>
            <button
              aria-label="Undo"
              data-tooltip="Undo (Command / Ctrl + Z)"
              aria-keyshortcuts="Meta+z Control+z"
              ?disabled=${!undo.length}
              data-action="undo"
            >
              ${icon(Undo2)}
            </button>
            <button
              aria-label="Redo"
              data-tooltip="Redo (Command / Ctrl + Shift + Z)"
              aria-keyshortcuts="Meta+Shift+z Control+Shift+z"
              ?disabled=${!redo.length}
              data-action="redo"
            >
              ${icon(Redo2)}
            </button>
            <button
              aria-label=${tool === 'crop' ? 'Clear crop' : 'Delete shape'}
              data-tooltip=${tool === 'crop' ? 'Clear crop (D)' : selected.size > 1 ? `Delete ${selected.size} shapes (D)` : 'Delete shape (D)'}
              aria-keyshortcuts="d"
              ?disabled=${tool === 'crop' ? !crop : selected.size === 0}
              data-action="delete"
            >
              ${icon(Trash2)}
            </button>
            <span class="separator"></span>
            <button
              aria-label="Cancel drawing"
              data-tooltip="Cancel drawing (Esc)"
              aria-keyshortcuts="Escape"
              data-action="cancel"
            >
              ${icon(X)}
            </button>
            <button
              class="save"
              aria-label=${capture ? 'Capture and attach' : 'Attach image'}
              data-tooltip=${capture ? 'Capture and attach (Command / Ctrl + Enter; hold Option / Alt to interact with the page)' : 'Attach image (Command / Ctrl + Enter)'}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              data-action="save"
            >
              ${icon(Check)}
            </button>
          </div>
          ${
            openPalette === 'color'
              ? html`<div
                  id="ainotation-color-palette"
                  class="palette color-popover"
                  role="dialog"
                  aria-label="Color palette"
                >
                  ${colors.map(
                    (value, index) => html`<button
                      class="swatch"
                      style=${`background:${value}`}
                      aria-label=${`Color ${value}`}
                      data-tooltip=${colorLabels[index]}
                      aria-pressed=${activeColor() === value}
                      data-color=${value}
                      ?data-highlighted=${paletteIndex === index}
                    ></button>`,
                  )}
                </div>`
              : nothing
          }
          ${
            openPalette === 'width'
              ? html`<div
                  id="ainotation-width-palette"
                  class="palette width-popover"
                  role="listbox"
                  aria-label="Line widths"
                >
                  ${strokeWidths.map(
                    (value, index) => html`<button
                      role="option"
                      aria-label=${`${value} px`}
                      aria-selected=${activeWidth() === value}
                      data-width=${value}
                      data-tooltip=${`${value} px`}
                      ?data-highlighted=${paletteIndex === index}
                    >
                      <span
                        class="width-preview"
                        style=${`height:${value}px`}
                        aria-hidden="true"
                      ></span
                      ><span>${value} px</span>
                    </button>`,
                  )}
                </div>`
              : nothing
          }
          <div id="ainotation-drawing-tooltip" class="tooltip" role="tooltip" hidden></div>
        </div>`,
      shadow,
    );
    positionPalette();
    showTooltip(tooltipTarget);
  }
  function chooseTool(value: Tool) {
    if (busy || gesture) return;
    closePalette();
    tool = value;
    selected.clear();
    paint();
  }
  function chooseColor(value: string) {
    if (busy || gesture) return;
    color = value;
    if ([...selected].some((index) => shapes[index]!.color !== value)) {
      remember(structuredClone(shapes));
      for (const index of selected) shapes[index]!.color = value;
    }
    closePalette(true);
    paint();
  }
  function chooseWidth(value: number) {
    if (busy || gesture || !strokeWidths.includes(value)) return;
    strokeWidth = value;
    if ([...selected].some((index) => (shapes[index]!.strokeWidth ?? 3) !== value)) {
      remember(structuredClone(shapes));
      for (const index of selected) shapes[index]!.strokeWidth = value;
    }
    closePalette(true);
    paint();
  }
  function activateToolbar(button: HTMLButtonElement, keyboard: boolean) {
    if (busy || gesture || button.disabled) return;
    const data = button.dataset;
    if (data.tool && Object.hasOwn(tools, data.tool)) {
      chooseTool(data.tool as Tool);
      return;
    }
    if (data.color && colors.includes(data.color)) {
      chooseColor(data.color);
      return;
    }
    if (data.width) {
      chooseWidth(Number(data.width));
      return;
    }
    if (data.action === 'color-palette') {
      togglePalette('color', keyboard);
      return;
    }
    if (data.action === 'width-palette') {
      togglePalette('width', keyboard);
      return;
    }
    closePalette();
    if (data.action === 'undo') undoShape();
    else if (data.action === 'redo') redoShape();
    else if (data.action === 'delete') deleteShape();
    else if (data.action === 'cancel') close();
    else if (data.action === 'save') void save();
  }
  function undoShape() {
    if (!undo.length || busy) return;
    redo.push({ shapes, selected: [...selected], crop });
    const previous = undo.pop()!;
    shapes = previous.shapes;
    selected = new Set(previous.selected);
    crop = previous.crop;
    paint();
  }
  function redoShape() {
    if (!redo.length || busy) return;
    undo.push({ shapes, selected: [...selected], crop });
    const next = redo.pop()!;
    shapes = next.shapes;
    selected = new Set(next.selected);
    crop = next.crop;
    paint();
  }
  function deleteShape() {
    if (tool === 'crop' && crop && !busy) {
      remember(structuredClone(shapes));
      crop = null;
      paint();
      return;
    }
    if (!selected.size || busy) return;
    remember(structuredClone(shapes));
    shapes = shapes.filter((_, index) => !selected.has(index));
    selected.clear();
    paint();
  }
  async function save() {
    if (busy || closed) return;
    cancelGesture();
    busy = true;
    paint();
    try {
      let blob: Blob;
      const region = crop ? normalizedCrop(crop, drawingBounds()) : undefined;
      if (capture) blob = await capture.snapshot(region);
      else {
        const element = shadow
          .querySelector<SVGSVGElement>('.drawing-surface')!
          .cloneNode(true) as SVGSVGElement;
        element.setAttribute('width', String(bitmap!.width));
        element.setAttribute('height', String(bitmap!.height));
        blob = await composeImage(
          bitmap!,
          new XMLSerializer().serializeToString(element),
          region,
          signal,
        );
      }
      signal.throwIfAborted();
      await options.onSave(blob);
      close();
    } catch (error) {
      if (!closed) {
        busy = false;
        notice = error instanceof Error ? error.message : 'Could not attach image.';
        paint();
      }
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(resumeTimer);
    lifetime.abort();
    capture?.stop();
    bitmap?.close();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    render(nothing, shadow);
    host.remove();
    options.onClose();
  }
  signal.addEventListener('abort', close, { once: true });
  bindDrawingPointerEvents({
    root: shadow,
    signal,
    passthrough,
    hover: showTooltip,
    activate: activateToolbar,
    draw(type, event, target, surface) {
      if (type === 'pointerdown') drawPointerDown(event, target, surface);
      else if (type === 'pointermove') drawPointerMove(event);
      else if (type === 'pointerup') drawPointerUp(event);
      else {
        cancelGesture();
        paint();
      }
    },
  });
  const tooltipControl = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
  for (const type of ['pointerover', 'pointermove', 'focusin']) {
    shadow.addEventListener(type, (event) => showTooltip(tooltipControl(event.target)), { signal });
  }
  shadow.addEventListener(
    'focusin',
    (event) => {
      const target = event.target;
      if (
        openPalette &&
        target instanceof Element &&
        !target.closest('.palette') &&
        target.getAttribute('data-action') !== `${openPalette}-palette`
      )
        closePalette();
    },
    { signal },
  );
  shadow.addEventListener(
    'pointerout',
    (event) => showTooltip(tooltipControl((event as PointerEvent).relatedTarget)),
    { signal },
  );
  shadow.addEventListener(
    'focusout',
    (event) => showTooltip(tooltipControl((event as FocusEvent).relatedTarget)),
    {
      signal,
    },
  );
  shadow.addEventListener('pointerdown', () => showTooltip(null), { capture: true, signal });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        openPalette &&
        !event
          .composedPath()
          .some(
            (node) =>
              node instanceof Element &&
              (node.classList.contains('palette') ||
                node.getAttribute('data-action')?.endsWith('-palette')),
          )
      )
        closePalette();
    },
    { capture: true, signal },
  );
  window.addEventListener('blur', () => showTooltip(null), { signal });
  for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup'])
    shadow.addEventListener(type, (event) => event.stopPropagation(), { signal });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (event.key === 'Alt') {
        alt = true;
        openPalette = null;
        cancelGesture();
        paint();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (openPalette) closePalette(true);
        else if (!busy) close();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) void save();
        return;
      }
      const editing = event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)),
        );
      if (busy || gesture || passthrough() || event.altKey || editing) return;
      if (openPalette && !event.metaKey && !event.ctrlKey) {
        const buttons = paletteButtons();
        const offsets: Record<string, number> = {
          ArrowRight: 1,
          ArrowDown: 1,
          ArrowLeft: -1,
          ArrowUp: -1,
        };
        const offset = offsets[event.key];
        if (offset !== undefined || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          event.stopImmediatePropagation();
          paletteIndex =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (paletteIndex + (offset ?? 0) + buttons.length) % buttons.length;
          paint();
          if (paletteKeyboard) paletteButtons()[paletteIndex]?.focus({ preventScroll: true });
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopImmediatePropagation();
          const button = buttons[paletteIndex];
          if (!event.repeat && button) activateToolbar(button, paletteKeyboard);
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) {
          if (event.shiftKey) redoShape();
          else undoShape();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (event.key.toLowerCase() === 'd') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) deleteShape();
        return;
      }
      const key = event.key.toLowerCase();
      const nextTool = (Object.keys(toolKeys) as Tool[]).find((tool) => toolKeys[tool] === key);
      if (!nextTool && key !== 'c' && key !== 's') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (nextTool) chooseTool(nextTool);
      else if (key === 'c')
        chooseColor(colors[(colors.indexOf(activeColor()) + 1) % colors.length]!);
      else {
        const current = activeWidth();
        chooseWidth(strokeWidths[(strokeWidths.indexOf(current) + 1) % strokeWidths.length]!);
      }
    },
    { capture: true, signal },
  );
  document.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Alt' || (alt && !event.altKey)) {
        alt = false;
        // Put the tool above any host popover opened during passthrough.
        if (host.matches(':popover-open')) host.hidePopover();
        raise();
        paint();
      }
    },
    { capture: true, signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (capture && (event.altKey || alt)) {
        passed.add(event.pointerId);
        paint();
      }
    },
    { capture: true, signal },
  );
  const release = (event: PointerEvent) => {
    if (passed.delete(event.pointerId)) {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(paint, 0);
    }
  };
  document.addEventListener('pointerup', release, { capture: true, signal });
  document.addEventListener('pointercancel', release, { capture: true, signal });
  window.addEventListener(
    'blur',
    () => {
      alt = false;
      passed.clear();
      cancelGesture();
      paint();
    },
    { signal },
  );
  window.addEventListener('resize', paint, { signal });
  document.addEventListener('scroll', paint, { capture: true, signal });
  if ('stream' in source)
    source.stream.getVideoTracks()[0]?.addEventListener(
      'ended',
      () => {
        notice = 'Screen sharing ended. Cancel and start a new screenshot, or import an image.';
        paint();
      },
      { signal },
    );
  paint();
  return { close };
}
