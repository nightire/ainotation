declare module 'virtual:ainotation/variants' {
  export const defineVariants: typeof import('@ainotation/sdk/variants').defineVariants;
  export type VariantSnapshot = import('@ainotation/sdk/variants').VariantSnapshot;
  export type VariantGroup = import('@ainotation/sdk/variants').VariantGroup;
}
