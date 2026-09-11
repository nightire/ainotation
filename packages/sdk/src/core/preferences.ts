import { OutputDetailSchema, type OutputDetail } from '@ainotation/schema';
import type { InspectorPosition, InspectorTheme } from './types';
import { createPreference } from './preference-store';

function parsePosition(value: unknown): InspectorPosition | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('left' in value) ||
    !('top' in value) ||
    !('opensLeft' in value)
  )
    return;
  if (
    typeof value.left !== 'number' ||
    !Number.isFinite(value.left) ||
    typeof value.top !== 'number' ||
    !Number.isFinite(value.top) ||
    typeof value.opensLeft !== 'boolean'
  )
    return;
  return { left: value.left, top: value.top, opensLeft: value.opensLeft };
}

const outputDetail = createPreference<OutputDetail>({
  key: (project) => project,
  parse(value) {
    const parsed = OutputDetailSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  },
});
const theme = createPreference<InspectorTheme>({
  key: (project) => ['theme', project],
  parse: (value) => (value === 'light' || value === 'dark' ? value : undefined),
  cache: {
    key: (project) => `ainotation:theme:${project}`,
    encode: (value) => value,
    decode: (value) => value,
  },
});
const position = createPreference<InspectorPosition>({
  key: (project) => ['position', project],
  parse: parsePosition,
  cache: {
    key: (project) => `ainotation:position:${project}`,
    encode: JSON.stringify,
    decode: JSON.parse,
  },
});

export async function readOutputDetail(project: string): Promise<OutputDetail> {
  return (await outputDetail.read(project)) ?? 'standard';
}
export function writeOutputDetail(project: string, detail: OutputDetail): Promise<void> {
  return outputDetail.write(project, detail);
}
export async function readTheme(project: string): Promise<InspectorTheme> {
  return (await theme.read(project)) ?? 'light';
}
export function writeTheme(project: string, value: InspectorTheme): Promise<void> {
  return theme.write(project, value);
}
export function readInspectorPosition(project: string): Promise<InspectorPosition | undefined> {
  return position.read(project);
}
export function writeInspectorPosition(project: string, value: InspectorPosition): Promise<void> {
  if (!parsePosition(value)) return Promise.reject(new Error('Invalid inspector position'));
  return position.write(project, value);
}
