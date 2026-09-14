import { expect, it, vi } from 'vite-plus/test';
import { createDrawingLayer } from './drawing-layer';

it('recovers the drawing layer when its host modal is removed and releases it on abort', async () => {
  const modal = document.createElement('dialog');
  document.body.append(modal);
  modal.showModal();
  const lifetime = new AbortController();
  try {
    const layer = createDrawingLayer('dark', lifetime.signal);
    expect(layer.host.parentElement).toBe(modal);
    modal.remove();
    await vi.waitFor(() => expect(layer.host.parentElement).toBe(document.documentElement));
    expect(layer.host.isConnected).toBe(true);
    lifetime.abort();
    expect(layer.host.isConnected).toBe(false);
    const fixture = document.createElement('div');
    document.body.append(fixture);
    fixture.remove();
    await Promise.resolve();
    expect(layer.host.isConnected).toBe(false);
  } finally {
    lifetime.abort();
    modal.remove();
  }
});

it('removes a partial layer when native popover setup fails', () => {
  const fail = vi.spyOn(HTMLElement.prototype, 'showPopover').mockImplementation(() => {
    throw new Error('Native layer unavailable');
  });
  try {
    expect(() => createDrawingLayer('light', new AbortController().signal)).toThrow(
      'Native layer unavailable',
    );
    expect(document.querySelector('[data-ainotation-ui="drawing"]')).toBeNull();
  } finally {
    fail.mockRestore();
  }
});
