import { LitElement, css, html } from 'lit';
import { createElement, X } from 'lucide';

export class InspectorShell extends LitElement {
  static override properties = {
    statusLabel: { type: String, attribute: 'status-label' },
  };

  static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      width: 320px;
      max-width: calc(100vw - 32px);
      color: #263330;
      font:
        14px/1.5 system-ui,
        sans-serif;
      letter-spacing: 0;
      color-scheme: light;
    }

    * {
      box-sizing: border-box;
    }

    section {
      padding: 16px;
      border: 1px solid #ced8d5;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 4px 20px #182c2414;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 650;
      overflow-wrap: anywhere;
    }

    button {
      display: grid;
      place-items: center;
      flex: 0 0 36px;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: #40524b;
      cursor: pointer;
    }

    button:hover {
      background: #edf3f0;
    }
    button:focus-visible {
      outline: 2px solid #087f75;
      outline-offset: 2px;
    }
    svg {
      width: 18px;
      height: 18px;
    }

    p {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 4px 16px;
      margin: 12px 0 0;
      color: #53635d;
      overflow-wrap: anywhere;
    }

    [role='status'] {
      min-width: 0;
      color: #087268;
    }
  `;

  declare statusLabel: string;

  constructor() {
    super();
    this.statusLabel = 'Ready';
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('ainotation-close', { bubbles: true, composed: true }));
  }

  override render() {
    return html`
      <section aria-label="Ainotation inspector">
        <header>
          <h2>Ainotation</h2>
          <button
            type="button"
            aria-label="Close inspector"
            title="Close inspector"
            @click=${() => this.close()}
          >
            ${createElement(X, { 'aria-hidden': 'true', focusable: 'false' })}
          </button>
        </header>
        <p><span>Inspector</span><span role="status">${this.statusLabel}</span></p>
      </section>
    `;
  }
}

export function registerInspectorShell(): void {
  if (!customElements.get('ainotation-inspector-shell')) {
    customElements.define('ainotation-inspector-shell', InspectorShell);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ainotation-inspector-shell': InspectorShell;
  }
}
