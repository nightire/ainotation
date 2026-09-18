import { css } from 'lit';

export const prototypeStyles = css`
  :host {
    display: block;
    color: var(--ain-text);
    font:
      13px/1.5 system-ui,
      sans-serif;
    color-scheme: var(--ain-scheme);
  }
  * {
    box-sizing: border-box;
  }
  [hidden] {
    display: none !important;
  }
  button,
  input,
  textarea,
  select {
    font: inherit;
  }
  button {
    cursor: pointer;
    color: inherit;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible,
  textarea:focus-visible,
  select:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--ain-focus);
    outline-offset: 3px;
  }
  button {
    border: 1px solid var(--ain-border);
    background: transparent;
    border-radius: 7px;
    padding: 7px 11px;
  }
  button:hover:not(:disabled) {
    background: var(--ain-hover);
  }
  .prototype {
    min-height: 940px;
    background: var(--ain-surface);
    padding: 28px 36px;
  }
  .topbar,
  .top-actions,
  .row,
  .tabs,
  .panel-heading,
  .target-line,
  .footer-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .topbar {
    justify-content: space-between;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--ain-border);
  }
  .wordmark {
    font-weight: 750;
    font-size: 19px;
    letter-spacing: -0.6px;
  }
  .badge {
    padding: 3px 7px;
    border-radius: 5px;
    background: var(--ain-surface-muted);
    color: var(--ain-muted);
    font:
      10px/1.5 ui-monospace,
      monospace;
    letter-spacing: 0.5px;
  }
  .intro {
    margin: 27px 0 0;
  }
  .intro h1 {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 7px;
    letter-spacing: -0.5px;
  }
  .intro p {
    margin: 0;
    color: var(--ain-muted);
    max-width: 680px;
  }
  .workspace {
    position: relative;
    min-height: 750px;
    padding-top: 42px;
  }
  .sample-area {
    width: 48%;
    max-width: 600px;
    padding: 12px 24px 100px 0;
  }
  .eyebrow {
    font:
      10px/1.5 ui-monospace,
      monospace;
    letter-spacing: 1px;
    color: var(--ain-muted);
    margin-bottom: 16px;
  }
  .sample {
    background: var(--ain-field);
    color: var(--ain-text);
    padding: 28px;
    border: 1px solid var(--ain-border);
    border-radius: 16px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 18px;
    position: relative;
  }
  .sample-label {
    font-size: 11px;
    letter-spacing: 1px;
    color: var(--ain-muted);
  }
  .sample h2 {
    font:
      600 30px/1.3 system-ui,
      sans-serif;
    letter-spacing: -1px;
    margin: 0;
    border: 0 solid var(--ain-border);
  }
  .sample p {
    margin: 0;
    color: var(--ain-muted);
    line-height: 1.8;
  }
  .sample .price {
    font-size: 36px;
    letter-spacing: -1px;
    font-weight: 650;
  }
  .price small {
    font-size: 12px;
    font-weight: 400;
    color: var(--ain-muted);
    letter-spacing: 0;
  }
  .sample ul {
    padding: 0;
    margin: 0;
    list-style: none;
    color: var(--ain-muted);
  }
  .sample li {
    margin: 8px 0;
  }
  .sample li::before {
    content: '✓';
    margin-right: 10px;
    color: var(--ain-text);
  }
  #prototype-cta {
    width: auto;
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: #00665a;
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    padding: 10px 18px;
    border: 1px solid #00665a;
    border-radius: 6px;
    margin: 0;
  }
  [data-selected='true'] {
    outline: 2px solid var(--ain-focus);
    outline-offset: 4px;
  }
  .target-marker {
    position: absolute;
    right: -13px;
    top: -13px;
    background: var(--ain-accent);
    color: var(--ain-on-accent);
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid var(--ain-focus);
    font-size: 12px;
  }
  .sample-hint {
    margin: 20px 0;
    color: var(--ain-muted);
    font-size: 12px;
  }
  .panel {
    position: absolute;
    left: 53%;
    top: 12px;
    width: 320px;
    padding: 12px;
    max-width: calc(100% - 16px);
    background: var(--ain-surface);
    border: 1px solid var(--ain-border);
    border-radius: 8px;
    box-shadow: 0 4px 20px var(--ain-shadow);
    overflow: hidden;
    z-index: 2;
  }
  .drag-handle {
    cursor: grab;
    touch-action: none;
    border: 0;
    padding: 4px;
    width: 24px;
    height: 24px;
    color: var(--ain-muted);
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .icon {
    padding: 4px;
    border: 0;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon svg,
  .drag-handle svg,
  .copy-selector svg {
    width: 14px;
    height: 14px;
  }
  .target-header {
    padding: 0 0 8px;
  }
  .target-line {
    gap: 4px;
    align-items: flex-start;
  }
  .target-line strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 12px;
    font-weight: 500;
    flex: 1;
  }
  .target-header code {
    display: block;
    font-size: 11px;
    color: var(--ain-muted);
    margin: 0;
  }
  .target-locator {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .target-locator code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .copy-selector {
    border: 0;
    width: 24px;
    height: 24px;
    padding: 4px;
    display: inline-flex;
    justify-content: center;
    align-items: center;
  }
  .target-details {
    color: var(--ain-muted);
    font:
      11px/1.5 ui-monospace,
      monospace;
  }
  .target-details summary {
    cursor: pointer;
    font:
      11px/1.5 system-ui,
      sans-serif;
  }
  .target-details pre {
    margin: 6px 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
  }
  .target-picker {
    margin-top: 10px;
    width: 100%;
  }
  .tabs {
    padding: 0;
    gap: 4px;
    border-bottom: 1px solid var(--ain-border);
  }
  .tabs button {
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 2px 8px;
    font-size: 12px;
    color: var(--ain-muted);
  }
  .tabs button[aria-selected='true'] {
    border-bottom-color: var(--ain-accent);
    color: var(--ain-text);
    font-weight: 650;
  }
  .pill {
    display: inline-block;
    margin-left: 5px;
    padding: 0 5px;
    font-size: 10px;
    border-radius: 4px;
    background: var(--ain-surface-muted);
  }
  .preview-row {
    padding: 10px 0;
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid var(--ain-border);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 11px;
    margin-right: auto;
  }
  .toggle input {
    accent-color: var(--ain-focus);
    width: 14px;
    height: 14px;
  }
  .panel-body {
    max-height: 390px;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  #styles-panel {
    border-bottom: 1px solid var(--ain-border);
    /* Revealing an original value must not shift the viewport under the pointer. */
    overflow-anchor: none;
  }
  #styles-panel > .section:last-child {
    border-bottom: 0;
  }
  .feedback-body {
    padding: 0;
    margin-top: 10px;
    max-height: 370px;
  }
  textarea {
    display: block;
    width: 100%;
    min-height: 80px;
    max-height: 240px;
    resize: vertical;
    background: var(--ain-field);
    color: var(--ain-text);
    border: 1px solid var(--ain-field-border);
    border-radius: 4px;
    padding: 7px 8px;
  }
  .section {
    border-bottom: 1px solid var(--ain-border);
  }
  .section summary {
    cursor: pointer;
    padding: 10px 0 10px 4px;
    font-size: 12px;
    font-weight: 600;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-chevron {
    display: inline-flex;
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    color: var(--ain-muted);
  }
  .section-chevron svg {
    width: 14px;
    height: 14px;
  }
  .section[open] .section-chevron {
    transform: rotate(90deg);
  }
  .section summary .pill {
    margin-left: auto;
  }
  .fields {
    padding: 0 0 12px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 10px;
  }
  .field {
    min-width: 0;
  }
  .field-label {
    display: flex;
    align-items: center;
    font-size: 10px;
    color: var(--ain-muted);
    height: 23px;
    gap: 4px;
  }
  .field-label .reset-dot {
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    flex: 0 0 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ain-accent);
  }
  .input-row {
    display: flex;
    align-items: center;
    background: var(--ain-field);
    border: 1px solid var(--ain-field-border);
    border-radius: 6px;
    overflow: hidden;
  }
  .field.changed .input-row {
    border-color: var(--ain-focus);
  }
  input[type='text'],
  select {
    width: 100%;
    min-width: 0;
    background: var(--ain-field);
    color: var(--ain-text);
    border: 1px solid var(--ain-field-border);
    border-radius: 6px;
    padding: 7px 8px;
    font-size: 12px;
  }
  .input-row input[type='text'],
  .input-row select {
    border: 0;
    border-radius: 0;
  }
  input[type='color'] {
    width: 26px;
    min-width: 26px;
    height: 27px;
    padding: 2px;
    margin-left: 5px;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .before {
    display: block;
    font:
      9px/1.4 ui-monospace,
      monospace;
    color: var(--ain-muted);
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .field-error {
    color: var(--ain-error);
    font-size: 10px;
  }
  .linked-row {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--ain-muted);
    font-size: 10px;
    padding-top: 2px;
  }
  .linked-row button {
    font-size: 10px;
    padding: 3px 7px;
  }
  .linked-row button[aria-pressed='true'] {
    background: var(--ain-selected);
    color: var(--ain-text);
  }
  .panel-footer {
    padding: 0;
  }
  .footer-note {
    color: var(--ain-muted);
    font-size: 10px;
    margin: 8px 0 0;
  }
  .style-restore {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
    color: var(--ain-muted);
    font-size: 10px;
  }
  .style-restore button {
    padding: 3px 0;
    font-size: 11px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .actions button {
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 4px;
    display: inline-flex;
    justify-content: center;
    align-items: center;
  }
  .actions svg {
    width: 16px;
    height: 16px;
  }
  .actions-end {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .actions .danger {
    color: var(--ain-error);
    border-color: var(--ain-error);
  }
  .actions .danger:hover {
    background: var(--ain-error-surface);
  }
  .import-hint {
    margin: 8px 0 0;
    font-size: 11px;
    color: var(--ain-muted);
  }
  .message {
    margin: 8px 0 0;
    overflow-wrap: anywhere;
    color: var(--ain-message);
    font-size: 11px;
  }
  .file-over {
    outline: 2px solid var(--ain-focus);
    outline-offset: 2px;
  }
  .images {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .image {
    position: relative;
    width: 84px;
    height: 64px;
  }
  .image img {
    width: 76px;
    height: 56px;
    object-fit: contain;
    display: block;
  }
  .image-preview {
    display: block;
    width: 100%;
    height: 100%;
    padding: 3px;
    border-radius: 4px;
  }
  .image svg {
    width: 14px;
    height: 14px;
  }
  .image-action {
    opacity: 0;
    pointer-events: none;
    position: absolute;
    right: 3px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    background: var(--ain-surface);
    box-shadow: 0 1px 3px var(--ain-shadow);
  }
  .image:hover .image-action,
  .image:focus-within .image-action {
    opacity: 1;
    pointer-events: auto;
  }
  .image-remove {
    top: 3px;
  }
  .image-download {
    bottom: 3px;
  }
  @media (hover: none) {
    .image-action {
      opacity: 1;
      pointer-events: auto;
    }
  }
  .primary {
    background: var(--ain-accent);
    color: var(--ain-on-accent);
    border-color: transparent;
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    background: var(--ain-accent-hover);
  }
  .quiet {
    border: 0;
    color: var(--ain-muted);
  }
  .saved {
    width: 48%;
    max-width: 600px;
    padding-right: 24px;
    margin-top: -60px;
  }
  .saved-card {
    border: 1px solid var(--ain-border);
    border-radius: 10px;
    background: var(--ain-field);
    padding: 16px;
  }
  .saved-card h3 {
    margin: 0;
    font-size: 13px;
  }
  .saved-card p {
    font-size: 12px;
    color: var(--ain-muted);
    white-space: pre-wrap;
  }
  .saved-card pre {
    overflow: auto;
    max-height: 280px;
    font-size: 11px;
    background: var(--ain-surface);
    padding: 10px;
    border-radius: 6px;
  }
  .saved-card details {
    margin-top: 10px;
  }
  .saved-card summary {
    cursor: pointer;
    font-size: 11px;
    color: var(--ain-muted);
  }
  .changes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    margin: 10px 0;
  }
  .changes-table td {
    padding: 6px 2px;
    border-bottom: 1px solid var(--ain-border);
    overflow-wrap: anywhere;
  }
  .changes-table td:first-child {
    color: var(--ain-muted);
  }
  .notice {
    margin: 16px 0 0;
    font-size: 12px;
    min-height: 20px;
    color: var(--ain-message);
  }
  @media (max-width: 820px) {
    .prototype {
      padding: 20px 16px;
    }
    .sample-area,
    .saved {
      width: 100%;
      max-width: 540px;
      padding-right: 0;
    }
    .sample-area {
      padding-bottom: 40px;
    }
    .saved {
      margin-top: 20px;
    }
    .panel {
      position: relative;
      left: auto;
      top: auto;
      width: 100%;
      max-width: 540px;
      margin-top: 16px;
    }
    .drag-handle {
      display: none;
    }
    .workspace {
      padding-top: 22px;
    }
    .topbar {
      align-items: flex-start;
    }
    .top-actions {
      gap: 4px;
    }
    .top-actions button {
      font-size: 11px;
      padding: 6px;
    }
  }
`;
