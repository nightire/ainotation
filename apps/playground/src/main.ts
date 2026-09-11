import { createAinotation } from '@ainotation/sdk';
import { createElement, PanelTop, X } from 'lucide';
import './style.css';
import { mountRoutes } from './routes';

const mountButton = document.querySelector<HTMLButtonElement>('#mount')!;
const unmountButton = document.querySelector<HTMLButtonElement>('#unmount')!;
const status = document.querySelector<HTMLElement>('#mount-status')!;
const events = new AbortController();
const disposeRoutes = mountRoutes();

document.querySelector('[data-icon="mount"]')!.append(createElement(PanelTop));
document.querySelector('[data-icon="unmount"]')!.append(createElement(X));

const inspector = createAinotation({ onDestroy: updateStatus });

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
