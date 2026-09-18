import type { TargetSnapshot } from '@ainotation/schema';
import type { DraftRecord } from './storage';

/** Includes explicit clears and links, even when the resulting document has no styles. */
export function requiresSharedStyles(record: Pick<DraftRecord, 'document' | 'operations'>) {
  const hasStyles = (target: TargetSnapshot) =>
    target.styleChanges !== undefined || target.styleTargetId !== undefined;
  return (
    record.document.targetStyles !== undefined ||
    record.document.annotations.some((annotation) => annotation.targets.some(hasStyles)) ||
    record.operations.some(
      (operation) =>
        operation.kind === 'upsert' &&
        (Object.keys(operation.styleLinks ?? {}).length > 0 ||
          operation.annotation.targets.some(hasStyles)),
    )
  );
}
