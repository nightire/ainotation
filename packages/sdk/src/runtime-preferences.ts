import { OutputDetailSchema } from '@ainotation/schema';
import type { InspectorShell } from './ui';
import type { InspectorAction, InspectorViewState } from './core/types';
import {
  readInspectorPosition,
  writeInspectorPosition,
  readOutputDetail,
  writeOutputDetail,
  readTheme,
  writeTheme,
} from './core/preferences';

type PreferenceAction = Extract<InspectorAction, { type: 'set-theme' | 'set-output-detail' }>;

/** Owns preference restoration and lifetime; does not participate in page feedback state. */
export function bindPreferences(
  shell: InspectorShell,
  project: string,
  view: InspectorViewState,
  signal: AbortSignal,
  changed: () => void,
  report: (message: string) => void,
) {
  let active = true;
  let savedPosition = '';
  const versions = { theme: 0, detail: 0 };
  const live = () => active && !signal.aborted;
  const persistPosition = () => {
    const position = shell.getPosition();
    if (!position || JSON.stringify(position) === savedPosition) return;
    savedPosition = JSON.stringify(position);
    void writeInspectorPosition(project, position).catch(() => {
      /* Pending memory state survives immediate remount. */
    });
  };
  const destroy = () => {
    if (!active) return;
    persistPosition();
    active = false;
    shell.removeEventListener('ainotation-position-change', persistPosition);
    signal.removeEventListener('abort', destroy);
  };
  shell.addEventListener('ainotation-position-change', persistPosition, { signal });
  signal.addEventListener('abort', destroy, { once: true });
  if (signal.aborted) destroy();

  const ready = readInspectorPosition(project).then(async (position) => {
    if (!position || !live()) return;
    await shell.updateComplete;
    if (!live()) return;
    const existing = shell.getPosition();
    shell.restorePosition(position);
    if (!existing && !savedPosition) savedPosition = JSON.stringify(shell.getPosition()) ?? '';
  });
  void readOutputDetail(project).then((detail) => {
    if (live() && versions.detail === 0) {
      view.outputDetail = detail;
      changed();
    }
  });
  void readTheme(project).then((theme) => {
    if (live() && versions.theme === 0) {
      view.theme = theme;
      changed();
    }
  });

  return {
    ready,
    destroy,
    async update(action: PreferenceAction) {
      if (!live()) return;
      if (action.type === 'set-theme') {
        if (action.value !== 'light' && action.value !== 'dark')
          throw new Error('Invalid inspector theme');
        versions.theme++;
        view.theme = action.value;
        changed();
        await writeTheme(project, action.value).catch(() => {
          if (live()) report('Theme changed for this session; the preference could not be saved.');
        });
      } else {
        const detail = OutputDetailSchema.parse(action.value);
        versions.detail++;
        view.outputDetail = detail;
        changed();
        await writeOutputDetail(project, detail).catch(() => {
          if (live())
            report('Output detail changed for this session; the preference could not be saved.');
        });
      }
    },
  };
}
