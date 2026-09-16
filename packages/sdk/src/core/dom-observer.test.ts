import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createDomObserver } from './dom-observer';

const observers: ReturnType<typeof createDomObserver>[] = [];
const fixtures: HTMLElement[] = [];
const settle = async () => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};
afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  for (const fixture of fixtures.splice(0)) fixture.remove();
  vi.restoreAllMocks();
});

function setup(exclude?: (element: Element) => boolean) {
  const fixture = document.createElement('div');
  document.body.append(fixture);
  fixtures.push(fixture);
  const onChange = vi.fn();
  const observer = createDomObserver({ onChange, ...(exclude ? { exclude } : {}) });
  observers.push(observer);
  observer.refresh();
  return { fixture, observer, onChange };
}

it('invalidates changing styles and text without rescanning the document', async () => {
  const { fixture, onChange } = setup();
  const text = document.createTextNode('Before');
  fixture.append(text);
  await settle();
  onChange.mockClear();
  const queries = vi.spyOn(document, 'querySelectorAll');
  for (let index = 0; index < 3; index++) {
    fixture.style.transform = `translateX(${index}px)`;
    text.data = `Frame ${index}`;
    await settle();
  }
  expect(onChange).toHaveBeenCalledTimes(3);
  expect(queries).not.toHaveBeenCalledWith('*');
});

it('observes added nested shadow trees and releases detached roots', async () => {
  const { fixture, onChange } = setup();
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const nested = document.createElement('div');
  root.append(nested);
  const inner = nested.attachShadow({ mode: 'open' });
  inner.innerHTML = '<span>Before</span>';
  fixture.append(host);
  await settle();
  onChange.mockClear();
  inner.querySelector('span')!.textContent = 'After';
  await settle();
  expect(onChange).toHaveBeenCalledOnce();
  host.remove();
  await settle();
  onChange.mockClear();
  inner.querySelector('span')!.textContent = 'Detached';
  await settle();
  expect(onChange).not.toHaveBeenCalled();
});

it('discovers a newly attached shadow root when its host changes', async () => {
  const { fixture, onChange } = setup();
  const root = fixture.attachShadow({ mode: 'open' });
  fixture.className = 'initialized';
  await settle();
  onChange.mockClear();
  root.innerHTML = '<span>New shadow content</span>';
  await settle();
  expect(onChange).toHaveBeenCalledOnce();
});

it.each(['mark', 'move'] as const)(
  'releases an observed shadow tree when it becomes tool UI via %s',
  async (mode) => {
    const { fixture, onChange } = setup();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<span>Visible</span>';
    const tool = document.createElement('div');
    tool.dataset.ainotationUi = 'test';
    fixture.append(host, tool);
    await settle();
    onChange.mockClear();
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    if (mode === 'mark') host.dataset.ainotationUi = 'test';
    else tool.append(host);
    await settle();
    expect(disconnect).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledOnce();
    onChange.mockClear();
    root.querySelector('span')!.textContent = 'Excluded';
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    if (mode === 'mark') host.removeAttribute('data-ainotation-ui');
    else fixture.append(host);
    await settle();
    onChange.mockClear();
    root.querySelector('span')!.textContent = 'Observed again';
    await settle();
    expect(onChange).toHaveBeenCalledOnce();
  },
);

it('ignores tool UI, handles changing custom exclusions and can reconnect', async () => {
  const { fixture, observer, onChange } = setup((element) => element.hasAttribute('data-private'));
  const host = document.createElement('div');
  host.setAttribute('data-private', '');
  const root = host.attachShadow({ mode: 'open' });
  fixture.append(host);
  await settle();
  onChange.mockClear();
  root.innerHTML = '<span>Private</span>';
  await settle();
  expect(onChange).not.toHaveBeenCalled();
  host.removeAttribute('data-private');
  await settle();
  onChange.mockClear();
  root.querySelector('span')!.textContent = 'Public';
  await settle();
  expect(onChange).toHaveBeenCalledOnce();

  onChange.mockClear();
  const tool = document.createElement('div');
  tool.dataset.ainotationUi = 'test';
  fixture.append(tool);
  tool.textContent = 'Tool content';
  await settle();
  expect(onChange).not.toHaveBeenCalled();

  observer.disconnect();
  root.querySelector('span')!.textContent = 'Paused';
  await settle();
  expect(onChange).not.toHaveBeenCalled();
  observer.refresh();
  root.querySelector('span')!.textContent = 'Resumed';
  await settle();
  expect(onChange).toHaveBeenCalledOnce();
});
