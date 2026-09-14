import { expect, it } from 'vite-plus/test';
import { themeStyles } from './theme';

function luminance(color: string) {
  const channels = color
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number)
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

it.each(['light', 'dark'])(
  'keeps %s theme text, primary actions and focus indicators readable',
  (theme) => {
    const host = document.createElement('div');
    host.dataset.theme = theme;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = themeStyles.cssText;
    const probe = document.createElement('span');
    shadow.append(style, probe);
    document.body.append(host);
    const pairs: [string, string, number][] = [
      ['text', 'surface', 4.5],
      ['text', 'field', 4.5],
      ['text', 'hover', 4.5],
      ['text', 'selected', 4.5],
      ['muted', 'surface', 4.5],
      ['muted', 'field', 4.5],
      ['muted', 'quote', 4.5],
      ['on-accent', 'accent', 4.5],
      ['on-accent', 'accent-hover', 4.5],
      ['error', 'surface', 4.5],
      ['error', 'error-surface', 4.5],
      ['message', 'surface', 4.5],
      ['on-tooltip', 'tooltip', 4.5],
      ['focus', 'surface', 3],
      ['focus', 'selected', 3],
      ['field-border', 'field', 3],
    ];
    try {
      for (const [foreground, background, minimum] of pairs) {
        probe.style.color = `var(--ain-${foreground})`;
        probe.style.backgroundColor = `var(--ain-${background})`;
        const computed = getComputedStyle(probe);
        const first = luminance(computed.color),
          second = luminance(computed.backgroundColor);
        const contrast = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        expect(contrast, `${theme}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(
          minimum,
        );
      }
    } finally {
      host.remove();
    }
  },
);
