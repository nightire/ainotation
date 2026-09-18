import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { StyleEditorPrototype } from './style-editor-prototype';

interface Args {
  theme: 'light' | 'dark';
  initialTab: 'feedback' | 'styles';
  multiple: boolean;
}

const meta = {
  title: 'Prototypes/Style Editor',
  parameters: { layout: 'fullscreen' },
  args: { theme: 'light', initialTab: 'feedback', multiple: false },
  argTypes: {
    theme: { control: 'inline-radio', options: ['light', 'dark'] },
    initialTab: { control: 'inline-radio', options: ['feedback', 'styles'] },
    multiple: { control: 'boolean' },
  },
  render: (args) => {
    const prototype = new StyleEditorPrototype();
    prototype.initialTab = args.initialTab;
    prototype.multiple = args.multiple;
    prototype.setAttribute('data-theme', args.theme);
    return prototype;
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Playground: Story = {};
export const FeedbackFirst: Story = { args: { initialTab: 'feedback' } };
export const StylesFirst: Story = { args: { initialTab: 'styles' } };
export const Dark: Story = { args: { theme: 'dark' } };
export const MultipleTargets: Story = { args: { multiple: true } };

export const NumericWheel: Story = {
  name: '数值滚轮 · 交互验证',
  args: { initialTab: 'styles' },
  play: async ({ canvasElement }) => {
    const component = canvasElement.querySelector<StyleEditorPrototype>(
      'ainotation-style-editor-prototype',
    )!;
    await component.updateComplete;
    const root = component.shadowRoot!;
    const ui = within(root.querySelector<HTMLElement>('.prototype')!);
    const padding = ui.getByRole('textbox', { name: '上内边距' }) as HTMLInputElement;
    const wheel = async (
      input: HTMLInputElement,
      options: {
        outside?: boolean;
        deltaX?: number;
        deltaY?: number;
        shiftKey?: boolean;
        ctrlKey?: boolean;
      } = {},
    ) => {
      const rect = input.getBoundingClientRect();
      const event = new WheelEvent('wheel', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX: options.outside ? rect.right + 10 : rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deltaY: options.deltaY ?? -80,
        deltaX: options.deltaX ?? 0,
        shiftKey: options.shiftKey ?? false,
        ctrlKey: options.ctrlKey ?? false,
      });
      input.dispatchEvent(event);
      await component.updateComplete;
      return event.defaultPrevented;
    };
    await expect(await wheel(padding)).toBe(false);
    await expect(padding.value).toBe('10px');
    padding.focus();
    await expect(await wheel(padding, { outside: true })).toBe(false);
    await expect(await wheel(padding, { ctrlKey: true })).toBe(false);
    await expect(padding.value).toBe('10px');
    await expect(await wheel(padding)).toBe(true);
    await expect(padding.value).toBe('11px');
    await expect(getComputedStyle(root.querySelector('#prototype-cta')!).paddingTop).toBe('11px');
    await wheel(padding, { shiftKey: true });
    await expect(padding.value).toBe('21px');
    await expect(await wheel(padding, { deltaY: 0, deltaX: 80 })).toBe(false);
    await expect(await wheel(padding, { deltaY: 0, deltaX: -80, shiftKey: true })).toBe(true);
    await expect(padding.value).toBe('31px');
    await wheel(padding, { deltaY: 0, deltaX: 80, shiftKey: true });
    await expect(padding.value).toBe('21px');
    await wheel(padding, { deltaY: 80 });
    await expect(padding.value).toBe('20px');
    await userEvent.click(ui.getByRole('button', { name: '撤销样式修改' }));
    await component.updateComplete;
    await expect(padding.value).toBe('21px');
    await fireEvent.input(padding, { target: { value: '1rem' } });
    await component.updateComplete;
    padding.focus();
    await wheel(padding);
    await expect(padding.value).toBe('1.1rem');
    await fireEvent.keyDown(padding, { key: 'ArrowDown' });
    await component.updateComplete;
    await expect(padding.value).toBe('1rem');
    await fireEvent.input(padding, { target: { value: '0' } });
    await component.updateComplete;
    await wheel(padding, { deltaY: 80 });
    await expect(padding.value).toBe('0px');
    const width = ui.getByRole('textbox', { name: '宽度' }) as HTMLInputElement;
    await fireEvent.input(width, { target: { value: 'auto' } });
    await component.updateComplete;
    width.focus();
    await expect(await wheel(width)).toBe(false);
    await expect(width.value).toBe('auto');
    await userEvent.click(ui.getByText('外观', { exact: true }));
    await component.updateComplete;
    const opacity = ui.getByRole('textbox', { name: '透明度' }) as HTMLInputElement;
    opacity.focus();
    await wheel(opacity);
    await expect(opacity.value).toBe('1');
    await wheel(opacity, { deltaY: 80 });
    await expect(opacity.value).toBe('0.95');
    const color = ui.getByRole('textbox', { name: '背景颜色' }) as HTMLInputElement;
    color.focus();
    const before = color.value;
    await expect(await wheel(color)).toBe(false);
    await expect(color.value).toBe(before);
    const reset = ui.getByRole('button', { name: '恢复上内边距' });
    await expect(reset.querySelector('.dot')).toBeTruthy();
    await expect(reset.querySelector('svg')).toBeNull();
    await userEvent.click(reset);
    await component.updateComplete;
    await expect(padding.value).toBe('10px');
    await expect(ui.queryByRole('button', { name: '恢复上内边距' })).toBeNull();
    component.dataset.verified = 'passed';
  },
};

export const VerifiedFlow: Story = {
  name: '保存与恢复 · 交互验证',
  args: { multiple: true, initialTab: 'styles' },
  play: async ({ canvasElement }) => {
    const component = canvasElement.querySelector<StyleEditorPrototype>(
      'ainotation-style-editor-prototype',
    )!;
    await component.updateComplete;
    const root = component.shadowRoot!;
    const ui = within(root.querySelector<HTMLElement>('.prototype')!);
    const button = root.querySelector<HTMLElement>('#prototype-cta')!;
    const card = root.querySelector<HTMLElement>('#prototype-card')!;
    const original = getComputedStyle(button).paddingTop;
    const originalCard = getComputedStyle(card).paddingTop;
    const fill = async (label: string, value: string) => {
      await fireEvent.input(ui.getByRole('textbox', { name: label }), {
        target: { value },
      });
      await component.updateComplete;
    };
    const click = async (name: string) => {
      const button = ui.getByRole('button', { name });
      button.focus();
      await userEvent.click(button);
      await component.updateComplete;
    };
    await click('独立编辑');
    await fill('上内边距', '16px');
    await expect(getComputedStyle(button).padding).toBe('16px');
    await click('撤销样式修改');
    await expect(getComputedStyle(button).paddingTop).toBe(original);
    await click('重做样式修改');
    await expect(getComputedStyle(button).padding).toBe('16px');
    await userEvent.click(ui.getByRole('checkbox', { name: /预览修改/ }));
    await component.updateComplete;
    await expect(getComputedStyle(button).paddingTop).toBe(original);
    await userEvent.click(ui.getByRole('checkbox', { name: /预览修改/ }));
    await component.updateComplete;
    await expect(getComputedStyle(button).paddingTop).toBe('16px');
    await click('选择父元素');
    await click('四边联动');
    await fill('上内边距', '36px');
    await expect(getComputedStyle(card).paddingTop).toBe('36px');
    await click('返回原目标');
    await expect((ui.getByRole('textbox', { name: '上内边距' }) as HTMLInputElement).value).toBe(
      '16px',
    );
    await fill('宽度', 'wrong');
    await expect(ui.getAllByRole('alert')[0]).toHaveTextContent('请输入有效的 CSS 值');
    await expect(ui.getByRole('button', { name: '添加标注' })).toBeDisabled();
    await click('恢复宽度');
    await userEvent.click(ui.getByRole('tab', { name: '反馈' }));
    await component.updateComplete;
    await fireEvent.input(ui.getByRole('textbox', { name: '反馈内容' }), {
      target: { value: '给按钮和卡片多一点空间。' },
    });
    await component.updateComplete;
    await click('添加标注');
    await expect(root.querySelector('.panel')).toBeNull();
    await expect(getComputedStyle(button).paddingTop).toBe(original);
    await expect(getComputedStyle(card).paddingTop).toBe(originalCard);
    const output = JSON.parse(root.querySelector('.saved-card pre')!.textContent!);
    await expect(output.comment).toBe('给按钮和卡片多一点空间。');
    await expect(output.targets[0].styleChanges[0]).toEqual({
      property: 'padding-top',
      before: original,
      value: '16px',
    });
    await expect(output.targets).toHaveLength(2);
    await click('重新编辑 / 预览');
    await userEvent.click(ui.getByRole('tab', { name: /样式/ }));
    await component.updateComplete;
    await expect(ui.getByRole('checkbox', { name: /预览修改/ })).not.toBeChecked();
    await userEvent.click(ui.getByRole('checkbox', { name: /预览修改/ }));
    await component.updateComplete;
    await fill('上内边距', '24px');
    await click('取消');
    await expect(getComputedStyle(button).paddingTop).toBe(original);
    await expect(JSON.parse(root.querySelector('.saved-card pre')!.textContent!)).toEqual(output);
    component.dataset.verified = 'passed';
  },
};

export const FeedbackAndImages: Story = {
  name: '反馈与附件 · 交互验证',
  play: async ({ canvasElement }) => {
    const component = canvasElement.querySelector<StyleEditorPrototype>(
      'ainotation-style-editor-prototype',
    )!;
    await component.updateComplete;
    const root = component.shadowRoot!;
    const ui = within(root.querySelector<HTMLElement>('.prototype')!);
    const click = async (name: string) => {
      const button = ui.getByRole('button', { name });
      button.focus();
      await userEvent.click(button);
      await component.updateComplete;
    };
    await expect(ui.getByRole('button', { name: '截图' })).toBeEnabled();
    await expect(ui.getByRole('button', { name: '选择图片' })).toBeEnabled();
    await expect(ui.queryByText('全部恢复')).toBeNull();
    await userEvent.click(ui.getByText('定位详情'));
    await expect(root.querySelector('.target-details')).toHaveAttribute('open');
    await expect(root.querySelector('.target-details pre')).toHaveTextContent('Shadow hosts:');
    await userEvent.click(ui.getByText('定位详情'));
    const comment = ui.getByRole('textbox', { name: '反馈内容' });
    await fireEvent.input(comment, { target: { value: '保留图片和原有反馈操作。' } });
    await component.updateComplete;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#faae2b';
    context.fillRect(0, 0, 160, 100);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), 'image/png'),
    );
    const file = new File([blob], 'reference.png', { type: 'image/png' });
    const finishDrawing = async (save: boolean) => {
      let editor: HTMLElement;
      await waitFor(
        async () => {
          editor = document.querySelector<HTMLElement>('[data-ainotation-ui="drawing"]')!;
          await expect(editor?.shadowRoot?.querySelector('[data-action="save"]')).toBeTruthy();
        },
        { timeout: 10000 },
      );
      const action = editor!.shadowRoot!.querySelector<HTMLButtonElement>(
        `[data-action="${save ? 'save' : 'cancel'}"]`,
      )!;
      await userEvent.click(action);
      await waitFor(
        () => expect(document.querySelector('[data-ainotation-ui="drawing"]')).toBeNull(),
        { timeout: 10000 },
      );
      await component.updateComplete;
    };
    await userEvent.upload(root.querySelector<HTMLInputElement>('input[type="file"]')!, file);
    await finishDrawing(true);
    await expect(ui.getByRole('button', { name: '编辑图片 1' })).toBeVisible();
    await expect(ui.getByRole('textbox', { name: '反馈内容' })).toHaveValue(
      '保留图片和原有反馈操作。',
    );
    await click('编辑图片 1');
    await finishDrawing(false);
    await expect(root.querySelectorAll('.feedback-body .image')).toHaveLength(1);
    await userEvent.click(ui.getByRole('tab', { name: /样式/ }));
    await component.updateComplete;
    await fireEvent.input(ui.getByRole('textbox', { name: '上内边距' }), {
      target: { value: '22px' },
    });
    await component.updateComplete;
    await userEvent.click(ui.getByRole('tab', { name: '反馈' }));
    await component.updateComplete;
    await expect(ui.getByRole('textbox', { name: '反馈内容' })).toHaveValue(
      '保留图片和原有反馈操作。',
    );
    await expect(ui.getByRole('button', { name: '编辑图片 1' })).toBeVisible();
    // A files-only paste must open the editor without replacing the text draft.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    ui.getByRole('textbox', { name: '反馈内容' }).dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
    await finishDrawing(true);
    await expect(root.querySelectorAll('.feedback-body .image')).toHaveLength(2);
    await click('移除图片 2');
    // Drop goes through the same real image editor.
    root.querySelector('.panel')!.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        composed: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    await finishDrawing(true);
    await fireEvent.keyDown(ui.getByRole('textbox', { name: '反馈内容' }), {
      key: 'Enter',
      ctrlKey: true,
    });
    await component.updateComplete;
    await expect(root.querySelector('.panel')).toBeNull();
    const output = JSON.parse(root.querySelector('.saved-card pre')!.textContent!);
    await expect(output.images).toHaveLength(2);
    await expect(output.images[0]).toMatchObject({
      width: 160,
      height: 100,
      mimeType: 'image/png',
    });
    await expect(output.targets[0].styleChanges).toHaveLength(1);
    await click('重新编辑 / 预览');
    await expect(ui.getByRole('button', { name: '删除标注' })).toBeEnabled();
    await click('移除图片 1');
    await click('取消');
    await expect(JSON.parse(root.querySelector('.saved-card pre')!.textContent!)).toEqual(output);
    await click('重新编辑 / 预览');
    await expect(root.querySelectorAll('.feedback-body .image')).toHaveLength(2);
    await click('删除标注');
    await expect(root.querySelector('.saved-card')).toBeNull();
    await expect(root.querySelector('.panel')).toBeNull();
    component.dataset.verified = 'passed';
  },
};
