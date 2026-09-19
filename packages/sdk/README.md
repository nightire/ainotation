# @ainotation/sdk

Framework-independent DOM annotations, image feedback and a Lit/Shadow DOM
inspector. Includes five interface languages and light/dark themes.

Most Vite projects should use [`@ainotation/vite`](https://www.npmjs.com/package/@ainotation/vite)
for automatic development-only injection and MCP pairing. The SDK also supports
manual integration; see the [project documentation](https://github.com/nightire/ainotation#readme).

```sh
pnpm add -D @ainotation/sdk@beta
```

Lit is provided by the SDK; hosts do not need to configure a rendering framework.
Feedback is saved locally. Screenshots require browser authorization; existing
PNG/JPEG/WebP images can also be pasted, dropped or selected.

The feedback popover includes a Styles tab for editing common CSS properties with
live preview, separately grouped padding/margin with all-side, axis and individual
controls, numeric wheel/keyboard adjustment, undo/redo and
per-property reset. `document.targetStyles` owns the shared original/desired values;
markers reference targets and expose derived `styleChanges` for compatibility.
Same-element markers edit the same draft. Multi-target markers default to batch
editing, with mixed values, relative stepping and atomic undo. The toolbar controls
global preview; local switches include/exclude the current targets. Saving and
closing keep the page preview; cancellation restores committed shared values.
Navigation and unmount remove all overrides. Drifted host styles require explicit
confirmation, and host writes are preserved when removing overrides. The last
marker referencing a target owns cleanup of that target's shared suggestions.
All Markdown levels, JSON/ZIP exports and MCP retain style suggestions. Older MCP
services must be updated and restarted; incompatible synchronization pauses with
local data retained.

Captured targets use uniquely verified CSS selectors: descriptive IDs, test IDs,
attributes and classes, followed by ancestor scopes and positional fallbacks.
Search is bounded to 256 candidate queries plus a final exact-path validation.
The feedback editor shows captured target context, a copyable selector and
expandable locator details. Shadow host selectors remain separate from the
selector inside their root. Existing saved selectors remain compatible.

Small per-target arrows in the editor select a parent or return along the path
just traversed. They preserve draft text and attachments, keep the marker anchor
in place, and work independently for multiple targets. Editing a saved annotation
only replaces its targets on Save; Cancel leaves the original annotation intact.
Adjusted drafts and each selection item's back-navigation path are retained in
the local marker editor context across save/reopen/remount. Related style targets
remain in the feedback document, but do not become additional selection rows just
because a navigation path touched them. Explicit multi-selection stays parallel.
Recorded paths are restored only for a compatible target set, and live identity
and parent relationships are checked before returning to a child. Older records
without navigation metadata retain their existing target list.

Restoration still checks target identity; a unique match is not proof of identity
after arbitrary page changes. New image snapshots also check captured `alt` and
safe literal `src` attributes. Signed/query URLs and data/blob sources are omitted
from the added source capture. These checks supplement the original element
reference and existing tag/text/attribute checks; ambiguous targets are not
silently rebound.

For an explicitly local-only instance:

```ts
import { createAinotation } from '@ainotation/sdk';

const inspector = createAinotation({ projectId: 'my-app', mcp: false });
await inspector.mount();
```

`mcp: false` disables MCP for this instance: it does not read or modify saved
connection credentials, start sync or accept connect/disconnect actions. Settings
shows a local-only explanation instead of connection controls or connection status.
Annotations, image attachments, copying and exporting remain available. Local
storage keeps the same project/page isolation; this option does not erase data or
change other instances. Do not combine it with `development`.

Omitting `mcp` retains manual connection and saved-credential restoration; an
`mcp: { endpoint, token }` object configures a manual connection. The Vite plugin
continues to use its automatic development bridge.

## UI Variants

With a compatible MCP connection, enable **UI Variants** in the Feedback panel.
Saving requests design exploration instead of an immediate replacement. The agent
reads the versioned guide, edits the host code and registers candidates. Compare
them in the page controller, then record **I want this**, **Regenerate**
or **Cancel**. Tell your agent when to continue; no tool call waits
and no client session is automatically resumed.

The compact controller shows the current design and a page indicator, with
Previous/Next buttons cycling through all designs including Original. It starts
at the bottom center (above the toolbar on narrow screens). Drag non-interactive
blank areas to move it, or focus the panel and use arrow keys. Its last position
is stored locally per project/full URL, restored on reload and clamped to the
visible viewport. Input, button and touch-scrolling behavior remains native;
position preferences are not included in feedback or MCP data.

The top-right minimize button collapses the controller to its title row. Use
Expand to restore the same candidate, feedback and open sections. The title row
remains draggable; minimizing does not end exploration or resume element picking.
Cancel is the last footer action, styled as destructive. A confirmation dialog
offers Keep comparing or Cancel; Escape returns to comparison. Cancellation is
recorded only after confirmation, and an exploration update dismisses a stale dialog.

After the agent reports cleanup complete, the annotation's UI Variants switch
returns to off and can be enabled again. Saving with it enabled starts a fresh
exploration on the same annotation, with a new exploration ID and round 1.
Ordinary saves retain the completed record. Old completion-related draft flags
are cleared on reload; an explicitly requested new exploration remains a draft
until saved.

Deleting an unfinished exploration's annotation (or clearing all annotations)
retains a separate `document.variantCleanups` record. The preview returns to
Original and the controller reminds the user to ask an agent to restore source
and remove generated candidates and temporary integration. The annotation and its
marker stay deleted; cleanup continues to reserve the page until the agent reports
completion. These records survive refresh and synchronize only with services
advertising `uiVariantsCleanup: 1`; older services leave local pending data intact.

While a published generation is being compared, element picking, selection outlines
and page markers are temporarily suspended. Interact with the page directly without
holding Alt; the controller and View annotation panel remain usable. Confirming,
regenerating or cancelling restores the existing picking mode. Collapsing the
inspector stays respected, and the next published generation suspends picking again.

There is one active exploration per project and full URL, including across browser
sessions. Original is separate from the default three candidates (1–6 supported).
Multiple targets switch as a complete design. Target roots must be visible and
disjoint; each can have different internal structure in each candidate. Related
style overrides pause while their drafts remain intact. Existing snapshots remain
unchanged. Local-only (`mcp: false`) instances do not expose this feature.

Use the host framework for conditional rendering. The development API is:

```ts
import { defineVariants } from '@ainotation/sdk/variants';

const group = defineVariants({
  explorationId, // from the annotation's variants object
  targetIds, // captured target UUIDs are slot IDs
  generations: [{ generation: 1, variants: ['compact', 'expressive', 'soft'] }],
});

const snapshot = group.getSnapshot(); // stable { generation, variantId }
const unsubscribe = group.subscribe(() => rerender());
// After the host commits its DOM, bind the snapshot used for THAT render:
const unbind = group.bind(targetIds[0], renderedRoot, snapshot);
// On root unmount: unbind(). On module/HMR disposal:
unsubscribe();
unbind();
group.dispose();
```

The disconnected and server-rendering snapshot is `{ generation: 0, variantId:
'original' }`. React can subscribe with `useSyncExternalStore` and bind refs in a
`useLayoutEffect` with cleanup. Vue can use `shallowRef`, `watchPostEffect` and
`onUnmounted`; pass the snapshot used to render, not a later store value.
The real framework integration fixtures in `apps/playground/tests/variant-framework-fixtures.ts`
exercise both patterns. No React/Vue dependency is added to the SDK.

Keep data and business handlers outside design branches where practical. Switching
may reset local component state. Scope candidate CSS to the selected instance.
Do not duplicate live component trees and merely hide inactive copies, add wrapper
elements that change layout, or globally alter a reusable component unintentionally.
Retain old generation implementations when staging a new generation. A manifest
being registered is distinct from the browser reporting all roots ready.

For Vite, prefer `virtual:ainotation/variants` and add
`/// <reference types="@ainotation/vite/variants" />` to your environment declarations.
Its production module always selects original and contains no SDK runtime. Gate
candidate modules/CSS behind development-only imports and check production output.
Other integrations must gate the SDK host API themselves.

Accept/cancel records a decision; the agent must still apply/restore the source and
remove the temporary integration, then report completion. Cancellation remains an
active handoff until cleanup is reported. Start a new annotation for a new
exploration after completion. Deleting/clearing annotations ends previews but does
not edit host source; remove leftover development scaffolding separately.

## License

MIT licensed, free for personal and commercial use, including modification,
redistribution, hosted services and proprietary integration. Retain the copyright
and license notices. See LICENSE for complete terms.
Bundled third-party components retain the licenses in THIRD_PARTY_NOTICES.
