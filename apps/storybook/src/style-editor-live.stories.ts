import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html, render } from 'lit';
import { createAinotation, type Ainotation } from '../../../packages/sdk/src/index';
import type { InspectorShell } from '../../../packages/sdk/src/ui';

class LiveStyleFeedback extends HTMLElement {
  theme: 'light' | 'dark' = 'light';
  private inspector?: Ainotation;
  private lifetime = 0;
  connectedCallback() {
    const lifetime = ++this.lifetime;
    this.style.cssText =
      'display:block;padding:48px;font:14px/1.5 system-ui;color:#00473e;min-height:900px;background:#f2f7f5';
    render(
      html`<aside data-ainotation-ui="story-help">
          <h2>正式 SDK · 样式反馈</h2>
          <p>保存或关闭编辑器后，页面会保留全部样式预览。工具栏的眼睛开关可对比整页原样。</p>
          <p>
            按住 Shift
            依次点选两个按钮，批量修改字号；也可在同一个按钮上创建多条标注，体验共享样式。
          </p>
          <p>反馈保存在这个浏览器的独立示例项目中。按住 Alt / Option 可与页面交互。</p>
        </aside>
        <section
          id="live-style-card"
          style="margin-top:48px;width:340px;padding:24px;border:1px solid #b9cdc4;border-radius:12px;background:white"
        >
          <h3 style="font-size:24px;margin:0 0 16px">给下一个想法，留点空间。</h3>
          <p>文字、图片与样式建议，一起交给你的编程助手。</p>
          <button
            id="live-style-target"
            style="padding:10px 18px;background:#00665a;color:white;border:1px solid #00665a;border-radius:6px;font:14px system-ui"
          >
            开始免费试用 ↗
          </button>
          <button
            id="live-style-secondary"
            style="margin-left:10px;padding:12px;background:white;color:#00665a;border:1px solid #00665a;border-radius:6px;font:16px system-ui"
          >
            了解详情
          </button>
        </section>`,
      this,
    );
    const inspector = createAinotation({
      projectId: `ainotation-storybook-styles-${this.theme}`,
      container: this,
      mcp: false,
    });
    this.inspector = inspector;
    void inspector
      .mount()
      .then(async () => {
        if (lifetime !== this.lifetime || !this.isConnected) return;
        const shell = this.querySelector<InspectorShell>('ainotation-inspector-shell')!;
        for (const detail of [
          { type: 'set-locale', value: 'zh-Hans' },
          { type: 'set-theme', value: this.theme },
        ])
          shell.dispatchEvent(new CustomEvent('ainotation-action', { detail }));
        await shell.updateComplete;
        if (lifetime !== this.lifetime || !this.isConnected) return;
        shell.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
        this.querySelector<HTMLButtonElement>('#live-style-target')!.click();
      })
      .catch((error: unknown) => {
        console.error('Live style editor story failed', error);
        if (lifetime === this.lifetime && this.isConnected)
          this.append('示例加载失败，请刷新重试。');
      });
  }
  disconnectedCallback() {
    this.lifetime++;
    this.inspector?.destroy();
  }
}
if (!customElements.get('ainotation-live-style-feedback'))
  customElements.define('ainotation-live-style-feedback', LiveStyleFeedback);

const meta = {
  title: 'Annotations/Style Editor',
  parameters: { layout: 'fullscreen' },
  args: { theme: 'light' },
  render: (args: { theme: 'light' | 'dark' }) => {
    const fixture = new LiveStyleFeedback();
    fixture.theme = args.theme;
    return fixture;
  },
} satisfies Meta<{ theme: 'light' | 'dark' }>;
export default meta;
type Story = StoryObj<{ theme: 'light' | 'dark' }>;
export const Live: Story = {};
export const Dark: Story = { args: { theme: 'dark' } };
