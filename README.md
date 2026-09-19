# Ainotation

**Visual feedback for web development and AI coding agents.**

[![npm beta](https://img.shields.io/npm/v/@ainotation/vite/beta?label=npm%20beta)](https://www.npmjs.com/package/@ainotation/vite)
[![Checks](https://github.com/nightire/ainotation/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/nightire/ainotation/actions/workflows/release.yml)

English · [简体中文](./README.zh-CN.md)

Select an element, describe what should change, and give your coding agent the context to act on it. Ainotation attaches feedback to real page elements and text selections, with DOM context and annotated screenshots available through MCP or exported files.

## Features

- **Feedback in context.** Annotate elements or text selections with selectors, styles, geometry and surrounding DOM information.
- **Try a style change.** Adjust common CSS properties on the real page, then save the original and desired values with your feedback.
- **Explore UI Variants.** Ask your agent for structural design candidates, compare them in place and record a decision before asking the agent to continue.
- **Draw on the page.** Add arrows, shapes and freehand strokes, select multiple shapes, and crop screenshots. Import images by pasting, dropping or choosing a file.
- **Work with AI agents.** Read and edit saved feedback through a local MCP service, including image attachments on demand.
- **Keep working locally.** Drafts and annotations survive reloads. Copy Markdown or export feedback without an MCP connection. No account or cloud service required.
- **Fit into your app.** Framework-independent UI, automatic Vite integration, and workspace-scoped project discovery for monorepos.
- **Make it yours.** Light and dark themes, keyboard shortcuts, and English, Simplified Chinese, Traditional Chinese, Japanese and Korean interfaces.

## Quick start

Requires **Node.js 24.20+ within the 24.x LTS line** and a **Vite 7/8 or Vite+** project.

### 1. Install the plugin

```sh
pnpm add -D @ainotation/vite@beta
```

The plugin includes the SDK and local service dependencies. You do **not** need to install `@ainotation/sdk` separately.

### 2. Add it to your Vite configuration

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { ainotation } from '@ainotation/vite';

export default defineConfig({
  plugins: [
    // Keep your existing framework plugins here.
    ainotation({ name: 'my-app' }),
  ],
});
```

For Vite+, import `defineConfig` from `vite-plus` instead.

### 3. Start your development server

Run your app's usual development command and open it in the browser. Click the floating **A** button, select an element, and write your first feedback.

The plugin handles injection and local pairing automatically. It is active only during development and does not inject Ainotation into production builds.

## Style suggestions

The annotation popover has **Feedback** and **Styles** tabs. Text and image actions
stay in Feedback; Styles groups size/spacing, typography, appearance and layout.
Focus a numeric field and scroll inside it (or use arrow keys) to adjust it;
Shift uses a 10× step. Click a modified field's yellow dot to restore it.
Padding and Margin have separate controls: each starts with one all-sides input,
with buttons to expand horizontal/vertical pairs or four individual sides. The
all-sides input remains available when expanded; click the active mode button
again to collapse. Switching modes never changes values. Grouped inputs display
mixed values, step each affected side relatively, and restore each side's original
value as one undoable operation. Undo/redo and preview support quick comparisons. Drag a
non-interactive blank area of the popover to move it without moving the annotation
marker. Inputs, selects, buttons, expandable headings and copyable locator text
keep their native interaction. You can also focus the panel and use arrow keys.
Each marker remembers its last tab, dragged position and editing scope, including
after a reload. Its local editor context also retains each selection item's
parent-navigation return path. Saving a child and its parent's style changes
does not turn that navigation path into two parallel selections on reopen;
explicit Shift selections stay separate. Paths are validated against live DOM
identity and parent relationships before navigating. Older annotations without
recorded navigation retain their target list; nesting alone never infers a path.
Parent/child navigation follows the affected member of that scope
without silently switching to all associated targets. With an editor open, an
ordinary click on the page first closes it and keeps the draft; another click can
select a new target. Shift selection and Option/Alt interaction remain available.

The toolbar's **Preview all changes** switch controls the entire current page and
starts on. Saving, closing an editor or collapsing the inspector keeps the full
preview visible. The local switch affects only the editor's selected targets;
global off restores the page and disables local switches. Global on restores the
previous local choices. Cancelling discards that editing scope's unsaved style
changes and restores its committed suggestions, without changing other targets.

Multiple markers on the same element edit one shared style record. Text and images
remain independent per marker. A Shift-selected marker edits all its targets by
default: differing values display **Mixed**, direct input sets a common value,
and wheel/arrow adjustments increment each target's own value. A batch is one undo
step; resetting restores each target's original value. You can narrow the editor
to one target. Missing targets prevent partial batch edits.

Shared original/desired declarations live in `document.targetStyles`. Targets
reference them by ID (or `styleTargetId` for verified aliases); inline
`styleChanges` are derived compatibility projections. Captured snapshots stay
unchanged. Shared drafts and preview preferences are isolated by project and full
page URL. Markdown emits each shared style once with references, and JSON/ZIP and
MCP retain both the shared records and expanded target context. Deleting a marker
keeps styles used by other markers; deleting the last reference removes them.

Preview overrides are always removed on navigation and unmount. Changed host
styles require confirmation and missing or replaced targets are never silently
rebound. Host writes are preserved when removing overrides. Suggestions describe
the desired result at the captured viewport; they do not require inline CSS in
the implementation. An annotation may include up to 20 targets.
Targets initially hidden or not yet mounted are retried when their DOM becomes
available. Restoration still validates identity; a previously bound node is never
silently replaced by a lookalike with the same selector.

Update and restart older MCP services before syncing style suggestions. The SDK
pauses incompatible sync and retains local feedback instead of accepting a
response that cannot preserve these fields.

## UI Variants

Connect a compatible MCP service, select one or more disjoint elements, and enable
**UI Variants** in the feedback panel. Save your request, then ask your coding agent
to read it. The agent reads Ainotation's integration guide, implements development-only
candidates in your host framework and registers them through MCP.

The page controller compares **Original** with three candidates by default (up to
six). Multi-target designs switch together; structure can change and local component
state may reset. A failed switch returns to the previous design. Original snapshots
and existing style drafts are retained; overlapping style overrides are paused.

Use Previous/Next to cycle through designs; the compact controller shows only the
current design and its page number, counting Original as a page. It starts at the
bottom center and can be moved by dragging blank areas. The position is remembered
locally per project/page and restored on refresh within the visible viewport.
The minimize button collapses it to a draggable title row; expanding retains the
current candidate and feedback without interrupting comparison.
Cancel is the last footer action with destructive styling and a confirmation
dialog. Keep comparing or Escape returns without recording a cancellation.
After the agent reports cleanup complete, the switch returns to off and can be
enabled again. Saving starts a fresh exploration on the same annotation; ordinary
saves retain the completed record.

Deleting an unfinished exploration's annotation, including Clear all, cancels the
exploration and returns the preview to Original. A separate pending cleanup record
survives refreshes and service restarts. Ask your agent to restore the source and
remove generated candidates and temporary integration; it can query and complete
cleanup using the former annotation ID. The page remains occupied until cleanup
is reported complete. Deletion does not automatically wake an agent or edit source.

During comparison, picking, selection outlines and page markers pause automatically
so you can interact with candidates directly. Confirming, regenerating or cancelling
restores picking; the next published generation pauses it again. The controller and
View annotation action remain available throughout comparison.

**I want this**, **Regenerate** and **Cancel** save your decision.
You decide when to tell the agent to continue. Selecting a design does not edit the
source automatically, and cancellation still needs the agent to remove temporary
integration. One exploration can be active per project/full page URL; other ordinary
annotations remain available. Local-only instances do not show UI Variants.

See the [SDK integration guide](packages/sdk/README.md#ui-variants) and
[MCP tools](packages/mcp/README.md#ui-variants). Vite provides
`virtual:ainotation/variants` with an original-only production fallback. Candidate
implementations and CSS must be development-gated by the host.

## Connect your coding agent

Add Ainotation to your MCP client. For clients that use an `mcpServers` configuration:

```json
{
  "mcpServers": {
    "ainotation": {
      "command": "npx",
      "args": ["--yes", "@ainotation/mcp@beta", "connect"]
    }
  }
}
```

The equivalent command is:

```sh
npx --yes @ainotation/mcp@beta connect
```

The client must expose the project's workspace roots or start the process in that workspace. If it does neither, append `--directory /absolute/path/to/your-project` to the arguments. Configuration syntax varies by MCP client.

Run `npx --yes @ainotation/mcp@beta --help` for CLI options.

Start the web app to register it, save some feedback, then ask your agent:

> Read the Ainotation feedback for my-app and address the requested UI changes.

The agent can discover projects, read feedback and images, and create, update or delete annotations. You can also use **Copy feedback** or **Export** to share feedback manually.

For missing files, interrupted services or damaged storage, use `ainotation-mcp doctor` and `ainotation-mcp repair`. Settings also supports retrying connections and restoring saved project pages from the browser. See [Reliability and recovery](./RECOVERY.md) for conflict handling and external backups.

### Multiple apps in one workspace

Give each app its own project name. To keep its identity when renaming it, provide a stable `id`:

```ts
ainotation({ name: 'Admin dashboard', id: 'my-company/admin' });
```

Use `ainotation_list_projects` to discover apps and pass `project` when more than one is available. A workspace-scoped connection cannot access projects outside its roots.

## Using Ainotation

1. **Select** an element or drag across page text. Hold **Shift** to select multiple elements.
2. **Describe** the change in the marker's popover. Add a screenshot or import an image when a visual explanation helps.
3. **Save** the feedback. Click a numbered marker to edit it later.
4. **Hand it off** through MCP, copied Markdown or an export.

Hold **Option / Alt** to interact with the real page while selecting or drawing. This lets you open menus, fill fields and prepare the state you want to annotate.

Settings lets you choose the interface language, theme and Markdown detail level. Preferences are saved per project. Feedback is separated by project and full page URL.

### Screenshots and images

Choose **Screenshot** in a marker's popover to draw directly on the page, or paste, drop or choose a PNG/JPEG/WebP image. The drawing tools support moving, resizing, rotation, marquee selection, undo/redo and cropping.

Screen capture requires a supported desktop browser, a secure context such as HTTPS or localhost, and your permission. Select the **current browser tab** for live cropping. Imported images remain available as an alternative when screen capture is unsupported.

Images are attached to the draft first; save the feedback to share them. Pages with images export as a ZIP containing Markdown, JSON and PNG files. Pages without images export as JSON. Copying collects saved feedback across the current project; export and clear apply to the current page.

<details>
<summary>Keyboard shortcuts</summary>

| Context              | Shortcut                 | Action                                                 |
| -------------------- | ------------------------ | ------------------------------------------------------ |
| Inspector            | Option/Alt + Shift + A   | Open or close                                          |
| Feedback input       | Command/Super + Enter    | Save feedback                                          |
| Selection or drawing | Hold Option/Alt          | Interact with the page                                 |
| Drawing              | V / A / R / E / F / X    | Select, arrow, rectangle, ellipse, free draw, crop     |
| Drawing              | C / S                    | Cycle color / line width                               |
| Drawing              | D                        | Delete selected shapes, or clear the crop in Crop mode |
| Drawing              | Command/Ctrl + Z         | Undo                                                   |
| Drawing              | Command/Ctrl + Shift + Z | Redo                                                   |
| Drawing              | Command/Ctrl + Enter     | Capture or attach the image                            |

Drawing shortcuts apply only while the image editor is open. Each toolbar action also has a tooltip.

</details>

## Packages

| Package                                   | Purpose                                                              |
| ----------------------------------------- | -------------------------------------------------------------------- |
| [`@ainotation/vite`](./packages/vite)     | Recommended integration: development injection and automatic pairing |
| [`@ainotation/sdk`](./packages/sdk)       | Browser inspector and manual lifecycle integration                   |
| [`@ainotation/mcp`](./packages/mcp)       | Local MCP service and workspace-scoped agent connection              |
| [`@ainotation/schema`](./packages/schema) | Feedback contracts, JSON Schema and Markdown/JSON handoff            |

The project is currently in beta. Use the `@beta` npm tag for the beta channel and see [Releases](https://github.com/nightire/ainotation/releases) for release notes.

<details>
<summary>Manual SDK integration</summary>

If you need to control mounting yourself, install the SDK as a direct dependency:

```sh
pnpm add -D @ainotation/sdk@beta
```

Run this in the browser after the document is ready:

```ts
import { createAinotation } from '@ainotation/sdk';

const inspector = createAinotation({ projectId: 'my-app' });
await inspector.mount();
```

Call `inspector.destroy()` when your integration is disposed. `getDocument()` returns the current feedback snapshot; `copyFeedback()` copies saved project feedback as Markdown. For manual integration, your app is responsible for restricting the tool to development. The Vite plugin handles this automatically.

Pass `mcp: false` to create a local-only instance: MCP connection controls, saved-credential restoration and synchronization are disabled, while annotations, copying and exporting remain available. This option cannot be combined with `development`; omitting it preserves existing connection behavior.

</details>

## Contributing

Bug reports, usability feedback and pull requests are welcome. Please [open an issue](https://github.com/nightire/ainotation/issues) for bugs or discuss larger changes before starting work.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, examples and checks, and [RELEASING.md](./RELEASING.md) for the Changesets release workflow.

## License

Ainotation is open source under the [MIT License](./LICENSE), free for personal and commercial use.

You may use, modify, distribute and sell copies, including in proprietary products and hosted services, provided you retain the copyright and license notices. Third-party components retain their own licenses.

Previously published `1.0.0-beta.0` and `1.0.0-beta.1` npm archives contain the earlier license. Use a subsequent release carrying MIT for the updated terms. See [LICENSE](./LICENSE) for the complete terms.
