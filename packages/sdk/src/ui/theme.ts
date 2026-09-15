import { css } from 'lit';

export const themeStyles = css`
  /* Happy Hues #5: mint surfaces, forest text and golden primary actions.
     Derived tones provide readable interaction and danger states. */
  :host {
    --ain-scheme: light;
    --ain-surface: #f2f7f5;
    --ain-surface-muted: #e2ece7;
    --ain-field: #fffffe;
    --ain-text: #00473e;
    --ain-brand-mark: #00473e;
    --ain-brand-container: #00473e;
    --ain-on-brand: #faae2b;
    --ain-muted: #475d5b;
    --ain-border: #b9cdc4;
    --ain-field-border: #77948a;
    --ain-hover: #e1ece6;
    --ain-selected: #fff0d2;
    --ain-accent: #faae2b;
    --ain-accent-hover: #eaa022;
    --ain-on-accent: #00473e;
    --ain-focus: #00665a;
    --ain-message: #00665a;
    --ain-quote: #fae4eb;
    --ain-quote-border: #ac5474;
    --ain-idle: #77948a;
    --ain-success: #00665a;
    --ain-error: #b8352c;
    --ain-error-surface: #fbe3de;
    --ain-shadow: #00332c26;
    --ain-tooltip: #00332c;
    --ain-on-tooltip: #fffffe;
    --ain-guide: #6b8279;
    --ain-guide-focus: #00665a;
    --ain-guide-fill: #00665a14;
    --ain-handle: #fffffe;
    --ain-crop-edge: #fffffe;
    --ain-crop-shade: #00332c52;
  }
  /* Happy Hues #10: teal surfaces, mint secondary text and warm gold. */
  :host([data-theme='dark']) {
    --ain-scheme: dark;
    --ain-surface: #004643;
    --ain-surface-muted: #001e1d;
    --ain-field: #003532;
    --ain-text: #fffffe;
    --ain-brand-mark: #f9bc60;
    --ain-brand-container: #e2ece7;
    --ain-on-brand: #00473e;
    --ain-muted: #abd1c6;
    --ain-border: #376f68;
    --ain-field-border: #7baba0;
    --ain-hover: #0f5650;
    --ain-selected: #34594b;
    --ain-accent: #f9bc60;
    --ain-accent-hover: #ffcd83;
    --ain-on-accent: #001e1d;
    --ain-focus: #f9bc60;
    --ain-message: #abd1c6;
    --ain-quote: #0f3433;
    --ain-quote-border: #abd1c6;
    --ain-idle: #7baba0;
    --ain-success: #abd1c6;
    --ain-error: #ffa19a;
    --ain-error-surface: #593d3d;
    --ain-shadow: #001e1d80;
    --ain-tooltip: #e8e4e6;
    --ain-on-tooltip: #001e1d;
    --ain-guide: #abd1c6;
    --ain-guide-focus: #f9bc60;
    --ain-guide-fill: #f9bc601c;
    --ain-handle: #001e1d;
    --ain-crop-edge: #fffffe;
    --ain-crop-shade: #001e1d8c;
  }
`;
