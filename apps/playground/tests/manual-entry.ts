import { createAinotation } from '@ainotation/sdk';
import { createElement, PanelTop, X } from 'lucide';
import '../src/style.css';
import { mountRoutes } from '../src/routes';

// Lifecycle controls are test fixtures; normal development uses the Vite plugin.
document.querySelector('.toolbar')!.insertAdjacentHTML(
  'afterbegin',
  `
  <button id="mount" type="button"><span data-icon="mount" aria-hidden="true"></span>Mount inspector</button>
  <button id="unmount" type="button" disabled><span data-icon="unmount" aria-hidden="true"></span>Unmount inspector</button>
`,
);

const mountButton = document.querySelector<HTMLButtonElement>('#mount')!;
const unmountButton = document.querySelector<HTMLButtonElement>('#unmount')!;
const status = document.querySelector<HTMLElement>('#mount-status')!;
const events = new AbortController();
const disposeRoutes = mountRoutes();

document.querySelector('[data-icon="mount"]')!.append(createElement(PanelTop));
document.querySelector('[data-icon="unmount"]')!.append(createElement(X));

const inspector = createAinotation({ onDestroy: updateStatus });
updateStatus();

function updateStatus(): void {
  status.textContent = inspector.mounted ? 'Mounted' : 'Unmounted';
  mountButton.disabled = inspector.mounted;
  unmountButton.disabled = !inspector.mounted;
}

mountButton.addEventListener(
  'click',
  async () => {
    mountButton.disabled = true;
    try {
      await inspector.mount();
      updateStatus();
    } catch {
      status.textContent = 'Mount failed';
      mountButton.disabled = false;
    }
  },
  { signal: events.signal },
);

unmountButton.addEventListener('click', () => inspector.destroy(), { signal: events.signal });

function dispose(): void {
  disposeRoutes();
  events.abort();
  inspector.destroy();
}

window.addEventListener('pagehide', dispose, { signal: events.signal });
import.meta.hot?.dispose(dispose);
