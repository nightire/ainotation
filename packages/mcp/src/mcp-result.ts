import { ProjectError } from './project';
import { StoreError } from './store';
import { ProjectChoiceError } from './project-choice';

export const jsonResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});
export async function toolResponse(run: () => unknown) {
  try {
    return jsonResult(await run());
  } catch (error) {
    return {
      ...jsonResult({
        error:
          error instanceof StoreError || error instanceof ProjectError
            ? error.message
            : 'Feedback operation failed',
        ...(error instanceof ProjectChoiceError ? { projects: error.projects } : {}),
      }),
      isError: true,
    };
  }
}
