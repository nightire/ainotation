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

## License

MIT licensed, free for personal and commercial use, including modification,
redistribution, hosted services and proprietary integration. Retain the copyright
and license notices. See LICENSE for complete terms.
Bundled third-party components retain the licenses in THIRD_PARTY_NOTICES.
