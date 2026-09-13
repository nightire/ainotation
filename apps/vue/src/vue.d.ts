// Plain TypeScript tooling uses this module declaration; vue-tsc checks the SFC itself.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
