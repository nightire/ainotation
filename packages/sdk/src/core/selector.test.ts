import { afterEach, expect, it, vi } from 'vite-plus/test';
import { selectorFor } from './selector';

const fixtures: Element[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((fixture) => fixture.remove());
  vi.restoreAllMocks();
});
function fixture(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  fixtures.push(root);
  return root;
}
function verified(element: Element, root: Document | ShadowRoot = document) {
  const selector = selectorFor(element, root);
  expect([...root.querySelectorAll(selector)]).toEqual([element]);
  return selector;
}

it('uses descriptive ancestor scope for duplicated light/dark logo images', () => {
  const root = fixture(
    '<header class="site-header"><a class="brand"><span class="brand-mark"><img class="logo-light"><img class="logo-dark"></span></a></header><footer><a class="brand"><span class="brand-mark"><img class="logo-light"><img class="logo-dark"></span></a></footer>',
  );
  const target = root.querySelector('header .logo-dark')!;
  expect(verified(target)).toBe('.site-header .logo-dark');
  const wrapper = document.createElement('div');
  target.parentElement!.prepend(wrapper);
  wrapper.append(target);
  expect(document.querySelector('.site-header .logo-dark')).toBe(target);
});

it('prefers stable attributes and escapes punctuation without modifying the host', () => {
  const root = fixture(
    '<button id="save:button[1]">Save</button><input name="email"><button data-testid="close-dialog"></button>',
  );
  const before = root.innerHTML;
  expect(verified(root.children[0]!)).toBe(`#${CSS.escape('save:button[1]')}`);
  expect(verified(root.children[1]!)).toBe('input[name="email"]');
  expect(verified(root.children[2]!)).toBe('[data-testid="close-dialog"]');
  expect(root.innerHTML).toBe(before);
});

it('avoids generated and state classes when a descriptive class is available', () => {
  const root = fixture(
    '<button id="radix-12345" class="active css-a12bc345 save-button"></button><button></button>',
  );
  expect(verified(root.firstElementChild!)).toBe('.save-button');
});

it('combines classes or uses a local position to distinguish otherwise identical siblings', () => {
  const root = fixture(
    '<div class="alpha beta"></div><div class="alpha gamma"></div><div class="beta gamma"></div><section id="export-menu"><button></button><button></button></section><button></button>',
  );
  expect(verified(root.firstElementChild!)).toBe('.alpha.beta');
  const target = root.querySelector('#export-menu')!.children[1]!;
  const selector = verified(target);
  expect(selector).toContain('nth-of-type(2)');
  expect(selector).not.toContain('html');
  expect(selector).not.toContain('body');
});

it('does not accept duplicated IDs and scopes selectors to each shadow root', () => {
  const root = fixture('<div id="duplicate"></div><div id="duplicate"></div>');
  expect(verified(root.firstElementChild!)).not.toBe('#duplicate');
  for (const host of root.children) {
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button class="save-button"></button>';
    expect(verified(shadow.firstElementChild!, shadow)).toBe('.save-button');
  }
});

it('bounds candidate queries on deep trees with many classes', () => {
  const root = fixture('');
  for (let branch = 0; branch < 2; branch++) {
    let parent: Element = root;
    for (let depth = 0; depth < 40; depth++) {
      const next = document.createElement('div');
      next.className = 'alpha beta gamma delta epsilon zeta eta theta';
      parent.append(next);
      parent = next;
    }
  }
  const target = root.firstElementChild!.querySelector('div:empty')!;
  const query = vi.spyOn(document, 'querySelectorAll');
  const selector = selectorFor(target, document);
  expect(query.mock.calls.length).toBeLessThanOrEqual(257);
  expect([...document.querySelectorAll(selector)]).toEqual([target]);
});
