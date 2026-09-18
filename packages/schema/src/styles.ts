import { z } from 'zod';

export const STYLE_SYNC_CAPABILITIES = { styleSuggestions: true, sharedStyles: true } as const;
export const StyleSyncCapabilitiesSchema = z.object({
  styleSuggestions: z.literal(true),
  sharedStyles: z.literal(true),
});

export const styleProperties = [
  'width',
  'height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'font-size',
  'line-height',
  'font-weight',
  'text-align',
  'color',
  'background-color',
  'border-width',
  'border-color',
  'border-radius',
  'opacity',
  'display',
  'gap',
  'flex-direction',
  'align-items',
  'justify-content',
] as const;
export const StylePropertySchema = z.enum(styleProperties);
export type StyleProperty = z.infer<typeof StylePropertySchema>;
// Literal declarations only. Never interpret URLs, custom properties or injected rules.
export const StyleValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => {
    for (const char of value) if (char.charCodeAt(0) < 32) return false;
    return !/[;{}<>\\@"']|\/\*|(?:url|image|image-set|paint|var|attr|env|expression)\s*\(/i.test(
      value,
    );
  }, 'Use a literal CSS property value without external resources.');
export const StyleChangeSchema = z.object({
  property: StylePropertySchema,
  before: z.string().max(1000),
  value: StyleValueSchema,
});
export const StyleChangesSchema = z
  .array(StyleChangeSchema)
  .max(styleProperties.length)
  .refine(
    (changes) => new Set(changes.map((change) => change.property)).size === changes.length,
    'Each CSS property may appear only once per target.',
  );
export type StyleChange = z.infer<typeof StyleChangeSchema>;
