// Storybook-only interaction model. This is not the SDK feedback contract.
export const fields = [
  { property: 'width', label: '宽度', group: 'size' },
  { property: 'height', label: '高度', group: 'size' },
  { property: 'padding-top', label: '上内边距', group: 'size' },
  { property: 'padding-right', label: '右内边距', group: 'size' },
  { property: 'padding-bottom', label: '下内边距', group: 'size' },
  { property: 'padding-left', label: '左内边距', group: 'size' },
  { property: 'margin-top', label: '上外边距', group: 'size' },
  { property: 'margin-bottom', label: '下外边距', group: 'size' },
  { property: 'font-size', label: '字号', group: 'text' },
  { property: 'line-height', label: '行高', group: 'text' },
  { property: 'font-weight', label: '字重', group: 'text', options: ['400', '500', '600', '700'] },
  { property: 'text-align', label: '对齐', group: 'text', options: ['left', 'center', 'right'] },
  { property: 'color', label: '文字颜色', group: 'text', color: true },
  { property: 'background-color', label: '背景颜色', group: 'appearance', color: true },
  { property: 'border-color', label: '边框颜色', group: 'appearance', color: true },
  { property: 'border-width', label: '边框宽度', group: 'appearance' },
  { property: 'border-radius', label: '圆角', group: 'appearance' },
  { property: 'opacity', label: '透明度', group: 'appearance' },
  {
    property: 'display',
    label: '显示方式',
    group: 'layout',
    options: ['block', 'inline-block', 'flex', 'grid', 'inline-flex'],
  },
  { property: 'gap', label: '间隙', group: 'layout' },
  {
    property: 'flex-direction',
    label: '方向',
    group: 'layout',
    options: ['row', 'column', 'row-reverse', 'column-reverse'],
  },
  {
    property: 'align-items',
    label: '交叉轴对齐',
    group: 'layout',
    options: ['normal', 'stretch', 'flex-start', 'center', 'flex-end'],
  },
  {
    property: 'justify-content',
    label: '主轴对齐',
    group: 'layout',
    options: ['normal', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around'],
  },
] satisfies Field[];

export interface Field {
  property: string;
  label: string;
  group: string;
  options?: string[];
  color?: boolean;
}

export const targets = [
  { id: 'prototype-cta', label: '开始免费试用', tag: 'button', parent: 'prototype-card' },
  { id: 'prototype-title', label: '给下一个想法，留点空间。', tag: 'h2', parent: 'prototype-card' },
  { id: 'prototype-card', label: '团队订阅卡片', tag: 'article', parent: null },
];

export const groups = [
  { id: 'size', label: '尺寸与间距' },
  { id: 'text', label: '排版' },
  { id: 'appearance', label: '外观' },
  { id: 'layout', label: '布局' },
];

export type Changes = Record<string, Record<string, string>>;

export function colorHex(value: string) {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  const rgb = value.match(/^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)\s*\)$/);
  return rgb
    ? `#${rgb
        .slice(1)
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')}`
    : null;
}
