import { expect, it } from 'vite-plus/test';
import { chooseProject, ProjectChoiceError } from './project-choice';
import { projectIdFor, type ProjectInfo } from './project';

it('does not guess between a display name and another project stable key, while UUID stays unambiguous', () => {
  const first: ProjectInfo = {
    root: '/workspace/first',
    config: { version: 1, projectId: projectIdFor('admin'), name: 'Dashboard' },
    toolchain: { kind: 'vite', configFiles: [] },
  };
  const second: ProjectInfo = {
    root: '/workspace/second',
    config: { version: 1, projectId: projectIdFor('store'), name: 'admin' },
    toolchain: { kind: 'vite', configFiles: [] },
  };
  expect(() => chooseProject([first, second], 'admin')).toThrow(ProjectChoiceError);
  expect(chooseProject([first, second], first.config.projectId)).toBe(first);
  second.config.name = first.config.projectId;
  expect(chooseProject([first, second], first.config.projectId)).toBe(first);
  expect(chooseProject([first], undefined)).toBe(first);
});
