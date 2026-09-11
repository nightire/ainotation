import { css } from 'lit';

export const themeStyles = css`
  :host {
    --ain-scheme: light;
    --ain-surface: #fff;
    --ain-field: #fff;
    --ain-text: #263330;
    --ain-muted: #53635d;
    --ain-border: #ced8d5;
    --ain-field-border: #bac8c2;
    --ain-hover: #edf3f0;
    --ain-accent: #087f75;
    --ain-accent-hover: #06695f;
    --ain-on-accent: #fff;
    --ain-message: #087268;
    --ain-quote: #edf5f1;
    --ain-idle: #9aa59f;
    --ain-error: #c25545;
    --ain-shadow: #182c2426;
  }
  :host([data-theme='dark']) {
    --ain-scheme: dark;
    --ain-surface: #202923;
    --ain-field: #151d18;
    --ain-text: #edf5f0;
    --ain-muted: #adbbb3;
    --ain-border: #43534a;
    --ain-field-border: #516358;
    --ain-hover: #35453c;
    --ain-accent: #74d9b1;
    --ain-accent-hover: #91e6c7;
    --ain-on-accent: #10271d;
    --ain-message: #91e6c7;
    --ain-quote: #273e33;
    --ain-idle: #7f9588;
    --ain-error: #f08e7d;
    --ain-shadow: #00000066;
  }
`;
