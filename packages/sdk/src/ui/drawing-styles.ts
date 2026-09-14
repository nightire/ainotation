import { css } from 'lit';
import { themeStyles } from './theme';

export const drawingStyles = css`
  ${themeStyles}
  * {
    box-sizing: border-box;
  }
  :host::backdrop {
    background: transparent;
    pointer-events: none;
  }
  .editor {
    font:
      13px/1.4 system-ui,
      sans-serif;
    color: var(--ain-text);
    color-scheme: var(--ain-scheme);
  }
  .stage {
    position: fixed;
    inset: 0;
    pointer-events: auto;
    touch-action: none;
  }
  .import {
    background: var(--ain-surface-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px 16px 110px;
  }
  .image-stage {
    position: relative;
    max-width: 100%;
    max-height: 100%;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
  .drawing-surface {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: crosshair;
  }
  .select {
    cursor: default;
  }
  .rotate-control {
    cursor: var(--rotation-cursor);
  }
  .rotating,
  .rotating * {
    cursor: var(--rotation-cursor) !important;
  }
  .pass,
  .pass * {
    pointer-events: none !important;
  }
  .toolbar {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100vw - 24px);
    display: flex;
    gap: 5px;
    padding: 8px;
    border: 1px solid var(--ain-border);
    border-radius: 10px;
    background: var(--ain-surface);
    box-shadow: 0 4px 20px var(--ain-shadow);
    pointer-events: auto;
    overflow-x: auto;
    align-items: center;
  }
  @media (max-width: 650px) {
    .toolbar {
      width: calc(100vw - 24px);
      flex-wrap: wrap;
      justify-content: center;
    }
    .notice {
      bottom: 116px !important;
    }
    .import {
      padding-bottom: 150px;
    }
  }
  button {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--ain-text);
    cursor: pointer;
  }
  button:hover {
    background: var(--ain-hover);
  }
  button[aria-pressed='true'] {
    border-color: var(--ain-focus);
    background: var(--ain-selected);
  }
  button:focus-visible {
    outline: 2px solid var(--ain-focus);
  }
  .stroke-width {
    flex-shrink: 0;
    height: 32px;
    width: 68px;
    padding: 0 4px;
    font: inherit;
    color: var(--ain-text);
    background: var(--ain-surface);
    border: 1px solid var(--ain-border);
    border-radius: 5px;
    cursor: pointer;
    gap: 5px;
  }
  .stroke-width svg {
    width: 12px;
    height: 12px;
  }
  .stroke-width:hover {
    background: var(--ain-hover);
  }
  .stroke-width:focus-visible {
    outline: 2px solid var(--ain-focus);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--ain-border);
    margin: 0 1px;
  }
  .swatch[aria-pressed='true'] {
    outline: 2px solid var(--ain-focus);
    outline-offset: 1px;
  }
  .color-trigger .swatch {
    display: block;
  }
  .palette {
    position: fixed;
    display: flex;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--ain-border);
    border-radius: 8px;
    background: var(--ain-surface);
    box-shadow: 0 4px 20px var(--ain-shadow);
    pointer-events: auto;
    max-height: calc(100vh - 32px);
    overflow: auto;
  }
  .width-popover {
    flex-direction: column;
    gap: 2px;
    padding: 6px;
  }
  .width-popover button {
    width: 100px;
    gap: 10px;
    padding: 0 8px;
    justify-content: space-between;
    font: inherit;
  }
  .width-popover button[aria-selected='true'] {
    background: var(--ain-selected);
  }
  .width-preview {
    display: block;
    width: 28px;
    background: currentColor;
    border-radius: 3px;
  }
  .palette [data-highlighted] {
    outline: 2px solid var(--ain-focus);
    outline-offset: 1px;
  }
  .separator {
    width: 1px;
    height: 24px;
    background: var(--ain-border);
    flex-shrink: 0;
    margin: 0 3px;
  }
  .save {
    background: var(--ain-accent);
    color: var(--ain-on-accent);
  }
  .save:hover:not(:disabled) {
    background: var(--ain-accent-hover);
  }
  .notice {
    position: fixed;
    bottom: 76px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100vw - 32px);
    padding: 5px 9px;
    background: var(--ain-surface);
    border-radius: 5px;
    text-align: center;
    pointer-events: none;
  }
  .tooltip {
    position: fixed;
    z-index: 1;
    width: max-content;
    max-width: calc(100vw - 16px);
    padding: 6px 9px;
    border-radius: 5px;
    background: var(--ain-tooltip);
    color: var(--ain-on-tooltip);
    font-size: 12px;
    line-height: 1.4;
    text-align: center;
    overflow-wrap: anywhere;
    box-shadow: 0 2px 8px var(--ain-shadow);
    pointer-events: none;
  }
  [hidden] {
    display: none !important;
  }
`;
