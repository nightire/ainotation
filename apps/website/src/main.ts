import './style.css';
import type { Ainotation } from '@ainotation/sdk';

const zh = {
  skip: '跳到正文',
  edition: '把事情看清楚的小工具。',
  eyebrow: '让 UI 反馈回到它的现场',
  heroLine1: '一条批注。',
  heroLine2: '恰在此处。',
  heroDescription: 'Ainotation 让反馈留在真实界面上。元素、截图和你的意图，一起交给编程 Agent。',
  marginNote: '把想法\n附在实处。',
  startFree: '或者，把它带进你的应用 ↓',
  tryDemo: '在这页留下一条批注',
  previewLabel: '一小块，正在使用的样张',
  sampleLabel: '从你的界面截取一角',
  sampleTitle: '再留一点空间，\n给下一个想法。',
  sampleBody: '还在打磨。\n值得讨论。',
  sampleButton: '邀请一位同伴',
  noteHeading: '写在页边',
  noteSelect: '给这个按钮，\n再留一点呼吸的空间。',
  noteContext: '准确的元素，会一起带上。',
  handoffEyebrow: '一份 Agent 可以用起来的说明',
  handoffTitle: '一条批注。\n完整的上下文。',
  handoffFeedback: '反馈',
  handoffFeedbackValue: '给这个操作多留一点空间',
  handoffElement: '元素',
  handoffContext: '上下文',
  handoffContextValue: '页面、位置与样式',
  handoffImage: '参考',
  receiptFoot: '通过 MCP 读取，或自行导出。',
  previewSelect: '这个元素',
  previewDraw: '这笔标记',
  previewHandoff: '这份交接',
  previewPrompt: '换个视角，跟着批注走。',
  proofFoot: '这里是示意预览。“留下一条批注”会打开真正的工具。',
  howEyebrow: '关于来回沟通的几条笔记',
  howTitle: '留在\n界面现场。',
  howDescription: '有用的反馈，有它的位置。\n有时，还需要一支箭头。',
  feature1Title: '点一下，就能找到。',
  feature1Body:
    '点选元素或选中一段文字。反馈会关联到页面上的准确位置，连同 Agent 需要的上下文一起保存。',
  feature2Title: '留下视觉上的指引。',
  feature2Body:
    '绘制、移动、旋转、裁剪，或导入已有截图。按住 Option / Alt，先打开那个菜单，再把它标出来。',
  feature3Title: '交出一份能动手的说明。',
  feature3Body: '通过 MCP 按需获取反馈和图片。也可以复制 Markdown，或将反馈和附件一起导出。',
  localTitle: '默认留在本地。',
  localBody: '反馈保存在浏览器中，按项目和页面整理。无需账号或云服务，MCP 也不是必选项。',
  startEyebrow: '把工具用起来',
  startTitle: '加入你的\n日常实践。',
  startDescription: '加两小段配置。\n然后，回到你的页面。',
  requirements: 'Vite 7/8 或 Vite+\nNode.js 24.20+（24.x）',
  stamp: '开发\n专用',
  installTitle: '你的应用',
  installNote: '保留现有插件，SDK 已包含在内。打开开发中的应用，找到浮动的 Ainotation 图标。',
  connectTitle: '你的编程 Agent',
  mcpConfiguration: 'MCP 客户端配置',
  connectNote: '客户端应提供工作区 roots，否则请追加 --directory 和项目路径。',
  setupGuide: '阅读接入说明',
  footnotes: '几件值得记住的小事',
  productionTitle: '属于开发工作台。',
  productionBody: 'Vite 插件只在开发环境启用，生产构建不包含检查器。屏幕截图会先征求你的授权。',
  licenseTitle: '开发使用免费。',
  licenseBody: '内部开发免费，包括商业项目。商业分发、托管服务及生产集成需另行获得授权。',
  readLicense: '完整许可证 ↗',
  footerTagline: '下一个细节，交给你。',
  docs: '使用指南',
  backToSetup: '带走这个工具 ↑',
  demoHint: '点击浮动的 Ainotation 图标，试着标注这个页面。演示反馈只保存在当前浏览器中。',
  exitDemo: '退出演示',
} satisfies Record<string, string>;

type Language = 'en' | 'zh-CN';
type Mode = 'select' | 'draw' | 'handoff';
const lifetime = new AbortController();
const { signal } = lifetime;
const root = document.documentElement;
const targets = [...document.querySelectorAll<HTMLElement>('[data-i18n]')];
const english = new Map(
  targets.map((element) => [
    element.dataset.i18n!,
    [...element.childNodes]
      .map((node) =>
        node.nodeName === 'BR' ? '\n' : (node.textContent ?? '').replace(/\s+/g, ' '),
      )
      .join('')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim(),
  ]),
);
const byId = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing website element: ${id}`);
  return element as T;
};
const themeButton = byId<HTMLButtonElement>('theme-toggle');
const languageButton = byId<HTMLButtonElement>('language-toggle');
const preview = byId('product-preview');
const toast = byId('toast');
const demoControls = byId('demo-controls');
const demoRoot = byId('demo-root');
const demoButton = byId<HTMLButtonElement>('try-demo');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let language: Language = 'en';
let mode: Mode = 'select';
let inspector: Ainotation | null = null;
let loadingDemo = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const copyTimers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
let followsSystem = true;
try {
  const preference = localStorage.getItem('ainotation.website.language');
  language =
    preference === 'en' || preference === 'zh-CN'
      ? preference
      : navigator.language.startsWith('zh')
        ? 'zh-CN'
        : 'en';
  followsSystem = !['light', 'dark'].includes(
    localStorage.getItem('ainotation.website.theme') ?? '',
  );
} catch {
  /* Optional preferences never block the page. */
}

const text = (key: keyof typeof zh) => (language === 'zh-CN' ? zh[key] : (english.get(key) ?? ''));
function announce(message: string) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}
function syncDemoAppearance() {
  const shell = demoRoot.querySelector('ainotation-inspector-shell');
  // This website ships from the same workspace as the SDK and uses its UI
  // action contract to keep the live example aligned with the page controls.
  shell?.dispatchEvent(
    new CustomEvent('ainotation-action', {
      detail: { type: 'set-theme', value: root.dataset.theme },
    }),
  );
  shell?.dispatchEvent(
    new CustomEvent('ainotation-action', {
      detail: { type: 'set-locale', value: language === 'zh-CN' ? 'zh-Hans' : 'en' },
    }),
  );
}
function updateControlLabels() {
  const dark = root.dataset.theme === 'dark';
  const themeLabel =
    language === 'zh-CN'
      ? `切换到${dark ? '浅色' : '深色'}模式`
      : `Switch to ${dark ? 'light' : 'dark'} mode`;
  themeButton.setAttribute('aria-label', themeLabel);
  themeButton.title = themeLabel;
  languageButton.textContent = language === 'en' ? '中文' : 'EN';
  languageButton.setAttribute('aria-label', language === 'en' ? '切换到中文' : 'Switch to English');
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.setAttribute('aria-label', language === 'zh-CN' ? '复制代码' : 'Copy code');
    button.title = language === 'zh-CN' ? '复制' : 'Copy';
  }
  demoButton.querySelector('span')!.textContent = loadingDemo
    ? language === 'zh-CN'
      ? '正在打开…'
      : 'Opening…'
    : inspector
      ? language === 'zh-CN'
        ? '演示已开启'
        : 'Demo is running'
      : text('tryDemo');
}
function setTheme(value: 'light' | 'dark', persist = true) {
  root.dataset.theme = value;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', value === 'dark' ? '#004643' : '#f2f7f5');
  if (persist) {
    followsSystem = false;
    try {
      localStorage.setItem('ainotation.website.theme', value);
    } catch {
      /* In-memory mode. */
    }
  }
  updateControlLabels();
  syncDemoAppearance();
}
function setMode(value: Mode) {
  mode = value;
  preview.dataset.mode = value;
  preview.querySelector<HTMLElement>('.handoff-card')!.hidden = value !== 'handoff';
  preview.querySelector<HTMLElement>('.specimen')!.inert = value === 'handoff';
  byId('preview-panel').setAttribute('aria-labelledby', `tab-${value}`);
  for (const tab of preview.querySelectorAll<HTMLButtonElement>('[data-preview]')) {
    const active = tab.dataset.preview === value;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  byId('preview-note').textContent =
    value === 'draw'
      ? language === 'zh-CN'
        ? '这里多留一点空间，会不会更舒服？'
        : 'A little more breathing room here, please.'
      : text('noteSelect');
  drawPreview();
}
function drawPreview() {
  if (mode !== 'draw') return;
  const frame = byId('preview-panel').getBoundingClientRect(),
    target = byId('preview-target').getBoundingClientRect();
  const x = target.x - frame.x,
    y = target.y - frame.y,
    w = target.width,
    h = target.height;
  const drawing = preview.querySelector<SVGSVGElement>('.draw-overlay')!;
  drawing.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
  drawing
    .querySelector('.draw-arrow')!
    .setAttribute(
      'd',
      `M${x - 110} ${y - 85} C${x - 40} ${y - 75},${x - 120} ${y + h / 2},${x - 15} ${y + h / 2} M${x - 29} ${y + h / 2 - 9} L${x - 15} ${y + h / 2} L${x - 31} ${y + h / 2 + 9}`,
    );
  drawing
    .querySelector('.draw-circle')!
    .setAttribute(
      'd',
      `M${x - 8} ${y - 5} C${x + w / 2} ${y - 20},${x + w + 15} ${y - 11},${x + w + 12} ${y + h / 2} C${x + w + 12} ${y + h + 17},${x - 20} ${y + h + 15},${x - 12} ${y + h / 2} C${x - 12} ${y + 5},${x - 9} ${y},${x - 8} ${y - 5}`,
    );
}
function setLanguage(value: Language, persist = true) {
  language = value;
  root.lang = value;
  clearTimeout(toastTimer);
  toast.hidden = true;
  for (const element of targets)
    element.textContent = text(element.dataset.i18n as keyof typeof zh);
  document.title =
    value === 'zh-CN' ? 'Ainotation — 一条批注，恰在此处。' : 'Ainotation — A note. In its place.';
  byId<HTMLAnchorElement>('docs-link').href =
    value === 'zh-CN'
      ? 'https://github.com/nightire/ainotation/blob/main/README.zh-CN.md'
      : 'https://github.com/nightire/ainotation#readme';
  byId<HTMLAnchorElement>('setup-guide').href = byId<HTMLAnchorElement>('docs-link').href;
  if (persist) {
    try {
      localStorage.setItem('ainotation.website.language', value);
    } catch {
      /* In-memory mode. */
    }
  }
  updateControlLabels();
  setMode(mode);
  syncDemoAppearance();
}
themeButton.addEventListener(
  'click',
  () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'),
  { signal },
);
languageButton.addEventListener('click', () => setLanguage(language === 'en' ? 'zh-CN' : 'en'), {
  signal,
});
systemTheme.addEventListener(
  'change',
  (event) => {
    if (followsSystem) setTheme(event.matches ? 'dark' : 'light', false);
  },
  { signal },
);
for (const button of preview.querySelectorAll<HTMLButtonElement>('[data-preview]')) {
  button.addEventListener('click', () => setMode(button.dataset.preview as Mode), { signal });
  button.addEventListener(
    'keydown',
    (event) => {
      const modes: Mode[] = ['select', 'draw', 'handoff'];
      let index = modes.indexOf(mode);
      if (event.key === 'ArrowRight') index = (index + 1) % modes.length;
      else if (event.key === 'ArrowLeft') index = (index + modes.length - 1) % modes.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = modes.length - 1;
      else return;
      event.preventDefault();
      setMode(modes[index]!);
      byId<HTMLButtonElement>(`tab-${mode}`).focus();
    },
    { signal },
  );
}
byId('preview-target').addEventListener(
  'click',
  () => {
    setMode('select');
    announce(
      language === 'zh-CN'
        ? '位置选好了。试试“画出想法”，补充视觉说明。'
        : 'That’s the spot. Try “Mark it up” to add a little more detail.',
    );
  },
  { signal },
);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.addEventListener(
    'click',
    () => {
      const source = byId(button.dataset.copy!);
      const content = source.textContent?.trim() ?? '';
      const writing = navigator.clipboard
        ? navigator.clipboard.writeText(content)
        : Promise.reject(new Error('Clipboard unavailable'));
      void writing
        .then(() => {
          if (signal.aborted) return;
          clearTimeout(copyTimers.get(button));
          button.classList.add('copied');
          button.querySelector('use')?.setAttribute('href', '#i-check');
          announce(
            language === 'zh-CN'
              ? '已复制，可以粘贴到你的项目中了。'
              : 'Copied. Ready to paste into your project.',
          );
          copyTimers.set(
            button,
            setTimeout(() => {
              button.classList.remove('copied');
              button.querySelector('use')?.setAttribute('href', '#i-copy');
              copyTimers.delete(button);
            }, 1800),
          );
        })
        .catch(() => {
          const range = document.createRange();
          range.selectNodeContents(source);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          announce(
            language === 'zh-CN'
              ? '代码已选中，请使用复制快捷键。'
              : 'Code selected. Use your copy shortcut.',
          );
        });
    },
    { signal },
  );
}
demoButton.addEventListener(
  'click',
  () => {
    if (loadingDemo || inspector) return;
    loadingDemo = true;
    demoButton.disabled = true;
    demoButton.setAttribute('aria-busy', 'true');
    updateControlLabels();
    void import('@ainotation/sdk')
      .then(async ({ createAinotation }) => {
        if (signal.aborted) return;
        demoControls.hidden = false;
        inspector = createAinotation({
          projectId: 'ainotation-website-demo',
          container: demoRoot,
          mcp: false,
        });
        await inspector.mount();
        if (signal.aborted) {
          inspector.destroy();
          inspector = null;
          return;
        }
        syncDemoAppearance();
      })
      .catch(() => {
        inspector?.destroy();
        inspector = null;
        demoControls.hidden = true;
        announce(
          language === 'zh-CN'
            ? '演示暂时无法加载，请刷新后重试。'
            : 'The demo could not load. Please refresh and try again.',
        );
      })
      .finally(() => {
        loadingDemo = false;
        demoButton.disabled = false;
        demoButton.removeAttribute('aria-busy');
        updateControlLabels();
      });
  },
  { signal },
);
byId('exit-demo').addEventListener(
  'click',
  () => {
    inspector?.destroy();
    inspector = null;
    demoControls.hidden = true;
    updateControlLabels();
    demoButton.focus({ preventScroll: true });
  },
  { signal },
);
function dispose() {
  lifetime.abort();
  inspector?.destroy();
  inspector = null;
  clearTimeout(toastTimer);
  for (const timer of copyTimers.values()) clearTimeout(timer);
  copyTimers.clear();
}
window.addEventListener(
  'pagehide',
  (event) => {
    if (!event.persisted) dispose();
  },
  { signal },
);
window.addEventListener('resize', drawPreview, { signal });
let progressFrame = 0;
function updateProgress() {
  progressFrame = 0;
  const distance = document.documentElement.scrollHeight - innerHeight;
  root.style.setProperty(
    '--reading-progress',
    String(distance > 0 ? Math.min(1, Math.max(0, scrollY / distance)) : 0),
  );
}
window.addEventListener(
  'scroll',
  () => {
    if (!progressFrame) progressFrame = requestAnimationFrame(updateProgress);
  },
  { passive: true, signal },
);
signal.addEventListener('abort', () => cancelAnimationFrame(progressFrame), { once: true });
import.meta.hot?.dispose(dispose);
setLanguage(language, false);
updateProgress();
