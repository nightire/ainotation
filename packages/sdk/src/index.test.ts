import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Ainotation } from './index.js';

const instances: Ainotation[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  for (const container of containers.splice(0)) container.remove();
});

describe('SDK lifecycle', () => {
  it('does not mutate the DOM or register elements on import or creation', async () => {
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    try {
      expect(customElements.get('ainotation-inspector-shell')).toBeUndefined();
      const { createAinotation } = await import('./index.js');
      const instance = createAinotation();
      instances.push(instance);
      expect(instance.mounted).toBe(false);
      expect(customElements.get('ainotation-inspector-shell')).toBeUndefined();
      expect([...mutations, ...observer.takeRecords()]).toHaveLength(0);
    } finally {
      observer.disconnect();
    }
  });

  it('mounts once into a custom container and renders in Shadow DOM', async () => {
    const { createAinotation } = await import('./index.js');
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const instance = createAinotation({ container });
    instances.push(instance);
    await Promise.all([instance.mount(), instance.mount()]);

    expect(instance.mounted).toBe(true);
    expect(container.children).toHaveLength(1);
    const shell = container.querySelector('ainotation-inspector-shell')!;
    await shell.updateComplete;
    expect(shell.shadowRoot?.querySelector('h2')?.textContent).toBe('Ainotation');
    expect(shell.shadowRoot?.querySelector('button svg')).not.toBeNull();
  });

  it('closes through a native event, cleans up, and can remount', async () => {
    const { createAinotation } = await import('./index.js');
    const onDestroy = vi.fn();
    const instance = createAinotation({ onDestroy });
    instances.push(instance);
    instance.destroy();
    expect(onDestroy).not.toHaveBeenCalled();
    await instance.mount();
    const shell = document.body.querySelector('ainotation-inspector-shell')!;
    await shell.updateComplete;
    const onClose = vi.fn();
    shell.addEventListener('ainotation-close', onClose, { once: true });
    shell.shadowRoot!.querySelector('button')!.click();

    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
    expect(instance.mounted).toBe(false);
    expect(shell.isConnected).toBe(false);
    expect(onDestroy).toHaveBeenCalledOnce();
    instance.destroy();
    expect(onDestroy).toHaveBeenCalledOnce();

    await instance.mount();
    shell.dispatchEvent(new CustomEvent('ainotation-close'));
    expect(instance.mounted).toBe(true);
    instance.destroy();
    expect(onDestroy).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector('ainotation-inspector-shell')).toBeNull();
  });

  it('keeps multiple instances independent', async () => {
    const { createAinotation } = await import('./index.js');
    const first = createAinotation();
    const second = createAinotation();
    instances.push(first, second);
    await first.mount();
    await second.mount();
    first.destroy();
    expect(second.mounted).toBe(true);
    expect(document.body.querySelectorAll('ainotation-inspector-shell')).toHaveLength(1);
  });

  it('does not mount a stale UI after destruction during lazy loading', async () => {
    const { createAinotation } = await import('./index.js');
    const instance = createAinotation();
    instances.push(instance);
    const mounting = instance.mount();
    instance.destroy();
    await mounting;
    expect(instance.mounted).toBe(false);
    expect(document.body.querySelector('ainotation-inspector-shell')).toBeNull();
    await instance.mount();
    expect(instance.mounted).toBe(true);
  });
});
