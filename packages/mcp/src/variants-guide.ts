export const VARIANTS_GUIDE_URI = 'ainotation://guides/ui-variants/v1';
export const VARIANTS_GUIDE = `# UI Variants — protocol v1

Read ainotation_get_variants for the annotation, original targets, exploration ID, generation and revision.
Generate three candidates unless the user requests another count (1–6). Original is separate.
Candidates may change structure. Preserve business behavior; scope CSS to the candidate and selected
instance. Do not modify a shared component globally when one instance was selected. Render exactly
one branch per target slot, using the host framework. Do not duplicate live components and hide them.
Each original target UUID is a slot ID, bound to one concrete connected root. Slots must not overlap.

## Development integration

Vite: import { defineVariants } from 'virtual:ainotation/variants'. Other integrations:
import from '@ainotation/sdk/variants' in development only. The Vite production module returns
the original snapshot and never starts the SDK/service. Candidate modules and CSS must be behind
import.meta.env.DEV / dynamic imports; verify the production bundle excludes temporary implementations.

Create one shared group for all selected instances:

    const group = defineVariants({
      explorationId: '<exploration UUID>',
      targetIds: ['<target UUID>', '<another target UUID>'],
      generations: [{ generation: 1, variants: ['compact', 'expressive', 'soft'] }],
    });

group.getSnapshot() returns a stable { generation, variantId } object. The disconnected snapshot is
{ generation: 0, variantId: 'original' }. group.subscribe(listener) returns an unsubscribe function.
Use the host's external-store/reactive integration to rerender when notified. Local UI state may reset.
Keep business data/handlers outside the branches where practical.
After committing each root, call group.bind(targetId, element, snapshotUsedForThisRender).
Call its returned cleanup when that root unmounts. All slots use the same snapshot.
Bindings add data-ainotation-exploration, data-ainotation-generation, data-ainotation-slot and
data-ainotation-variant attributes. Never infer identity from selector similarity.
Call group.dispose() on module/HMR disposal; never leave duplicate group registrations.

For regeneration, retain the previous generation's implementations while adding the new generation
to generations. Choose implementations using both snapshot.generation and snapshot.variantId.
Keep the old generation previewable until the new manifest is published. Never reuse generation IDs.

## Publish

Run host checks. Call ainotation_publish_variants with a fresh operationId, exact explorationId,
generation/revision, and candidate IDs/labels/descriptions (without original). Reuse operationId on retries.
Publishing registers metadata, not browser readiness. Inspect the waiting/ready/error report, its
clientId and observedAt. An old report does not prove the page is currently connected.
The browser validates all slots and rolls failed switches back to the previous snapshot.
Tell the user the candidates are ready and finish the turn. Do not block the conversation waiting,
poll indefinitely, or auto-resume. A preview selection is not acceptance.

## Continue when the user asks

Re-read ainotation_get_variants and check the latest decision ID/generation and additional feedback.
Regenerate: implement the newly requested generation and publish with its current revision.
Accept: make the chosen design the normal implementation. Cancel: restore the original.
Remove unused candidates, temporary CSS, subscriptions, bindings and integration imports; verify
development/production behavior. Then call ainotation_complete_variants with the exact decision ID,
current revision and a cleanup summary. Completion is an agent report; the page also checks that
temporary registrations are gone. Never report completion before editing source. On conflict,
re-read the latest state instead of overwriting a newer user decision.

## Deleted annotations and pending cleanup

Deleting an annotation (including Clear all) cancels its unfinished exploration but does not
edit host source. The browser returns to Original. The feedback document retains a separate
variantCleanups entry with the former annotation ID, original page/target context, manifest,
generation/revision and cancellation decision. It remains visible through ainotation_list_sessions and
ainotation_get_feedback, and ainotation_get_variants accepts the former annotation ID. Check these pending entries
when continuing work, including from a new agent session; do not rely on conversation history.

A cancelled cleanup with reason annotation-deleted requires restoring the original implementation
and removing all generated candidates, candidate CSS, temporary modules, imports, subscriptions
and bindings. Search for its exploration ID and the temporary registration to locate the code;
preserve unrelated user changes. Do not publish replacement candidates or recreate the annotation.
Run the host checks, then use ainotation_complete_variants with the retained annotation ID and the exact
latest exploration/generation/revision/decision IDs. Re-read on conflict. Pending cleanup keeps
the page occupied until completion, including across refreshes and service restarts. Completed
cleanup entries are receipts, not new tasks: never repeat their source changes. Deletion never
automatically wakes an agent; the user must ask you to continue.
`;
