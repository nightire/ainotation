import { afterEach, describe, expect, it } from 'vite-plus/test';
import { TargetSnapshotSchema } from '@ainotation/schema';
import { createSelection } from './selection';
import { captureTextRange, rangeBetween } from './text-selection';

const fixtures: HTMLElement[] = [];
const selectors: ReturnType<typeof createSelection>[] = [];
function setup(markup: string) {
  const fixture = document.createElement('section');
  fixture.id = `context-${crypto.randomUUID()}`;
  fixture.innerHTML = markup;
  document.body.append(fixture);
  fixtures.push(fixture);
  const selection = createSelection({ onChange() {} });
  selectors.push(selection);
  return { fixture, selection };
}
afterEach(() => {
  for (const selection of selectors.splice(0)) selection.destroy();
  for (const fixture of fixtures.splice(0)) fixture.remove();
});

describe('captured DOM context', () => {
  it('captures ancestry, nearby visible content, semantic attributes and styles without form values or tool text', () => {
    const { fixture, selection } = setup(
      '<p>Before context</p><span hidden>HIDDEN_PAYLOAD</span><input id="semantic-input" type="password" name="password" placeholder="Enter password" aria-describedby="description" aria-hidden="false" tabindex="0" value="PRIVATE_VALUE" style="border-radius:9px;letter-spacing:2px"><div data-ainotation-ui>TOOL_SECRET</div><p id="description">After context</p>',
    );
    const input = fixture.querySelector('input')!;
    selection.select(input);
    const target = selection.getTargets()[0]!;
    expect(target.selector).toBe('#semantic-input');
    expect(target.ancestors!.at(-1)?.attributes.id).toBe(fixture.id);
    expect(target.nearbyText).toEqual({ before: 'Before context', after: 'After context' });
    expect(target.attributes).toMatchObject({
      type: 'password',
      name: 'password',
      placeholder: 'Enter password',
      'aria-describedby': 'description',
      tabindex: '0',
    });
    expect(target.label).toContain('Enter password');
    expect(target.styles).toMatchObject({ 'border-radius': '9px', 'letter-spacing': '2px' });
    expect(target.accessibility?.focusable).toBe(true);
    expect(target.nearbyElements).toHaveLength(2);
    for (const text of ['PRIVATE_VALUE', 'TOOL_SECRET', 'HIDDEN_PAYLOAD'])
      expect(JSON.stringify(target)).not.toContain(text);
    expect(TargetSnapshotSchema.parse(JSON.parse(JSON.stringify(target)))).toEqual(target);
    input.disabled = true;
    selection.clear();
    selection.select(input);
    expect(selection.getTargets()[0]!.accessibility?.focusable).toBe(false);
  });

  it('records shadow ancestry and marks bounded deep paths as truncated', () => {
    const { fixture, selection } = setup('<div id="context-host"></div>');
    const root = fixture.firstElementChild!.attachShadow({ mode: 'open' });
    root.innerHTML = '<p id="inside-context">Text</p>';
    selection.select(root.firstElementChild!);
    const shadow = selection.getTargets()[0]!;
    expect(shadow.shadowHosts).toEqual(['#context-host']);
    expect(
      shadow.ancestors!.some((node) => node.attributes.id === 'context-host' && node.shadowHost),
    ).toBe(true);
    let parent: Element = fixture;
    for (let i = 0; i < 40; i++) {
      const child = document.createElement('div');
      parent.append(child);
      parent = child;
    }
    parent.id = 'deep-context';
    parent.textContent = 'Deep';
    selection.select(parent);
    const deep = selection.getTargets()[0]!;
    expect(deep.ancestors).toHaveLength(32);
    expect(deep.ancestryTruncated).toBe(true);
    expect(TargetSnapshotSchema.safeParse(deep).success).toBe(true);
  });
});

describe('text quote snapshots', () => {
  const excluded = (element: Element) => !!element.closest('[data-ainotation-ui]');
  it('normalizes reverse ranges across inline nodes and captures surrounding quote context', () => {
    const { fixture } = setup('<p>Before <span>wrong <em>label</em></span> after.</p>');
    const span = fixture.querySelector('span')!;
    const start = span.firstChild as Text;
    const end = span.querySelector('em')!.firstChild as Text;
    const range = rangeBetween({ node: end, offset: 5 }, { node: start, offset: 0 })!;
    expect(captureTextRange(range, excluded)?.selection).toMatchObject({
      exact: 'wrong label',
      prefix: 'Before ',
      suffix: ' after.',
      truncated: false,
    });
    end.data = '';
    expect(rangeBetween({ node: start, offset: 0 }, { node: end, offset: 5 })).toBeNull();
  });
  it('omits hidden, tool and editable text within a range and bounds long quotes', () => {
    const { fixture } = setup(
      '<p>Visible <span hidden>HIDDEN_VALUE</span><span data-ainotation-ui>TOOL_VALUE</span><textarea>FORM_VALUE</textarea><b>end</b></p>',
    );
    const paragraph = fixture.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    expect(captureTextRange(range, excluded)?.selection.exact).toBe('Visible end');
    paragraph.textContent = 'x'.repeat(1500);
    range.selectNodeContents(paragraph);
    const long = captureTextRange(range, excluded)!.selection;
    expect(long.exact).toHaveLength(1000);
    expect(long.truncated).toBe(true);
    expect(long.rects.length).toBeLessThanOrEqual(32);
    expect(long.prefix.length).toBeLessThanOrEqual(64);
    expect(long.suffix.length).toBeLessThanOrEqual(64);
  });
});
