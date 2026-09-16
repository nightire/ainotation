# @ainotation/sdk

## 1.0.0-beta.1

### Minor Changes

- b4e20f9: Generate bounded, uniquely verified CSS selectors using descriptive attributes, classes and ancestor scopes before positional fallback. Show readable target context with copyable selectors and expandable shadow-root details, and validate captured image source/alt attributes on restoration while retaining compatibility with older annotations.
- 1e7c5ad: Add `mcp: false` for local-only instances that skip saved MCP credentials, connections and synchronization while retaining annotations, image attachments, copying and exporting. Settings explains local-only operation in all five supported languages.
- b4e20f9: Add compact per-target parent and back controls to annotation popovers. Target changes preserve feedback drafts, attachments and marker position, support open shadow boundaries and independent multi-selection, and update saved annotation targets only on explicit save.
- d994c13: Recover missing service state through an independent instance coordinator, repair loaded snapshots, retain JSON backups, and add doctor/repair/external-backup commands. Introduce storage epochs and missing-image negotiation, pause conflicting recovery before replacing browser feedback, and add project restoration and version-choice controls with retained local copies. Protect coordinator credentials from Vite file serving.

### Patch Changes

- 1e7c5ad: Use the Ainotation arrow-and-dot logo in the circular launcher and Settings, with the approved light and dark brand colors.
- 5afa2bc: Share typed sync diagnostics across the service, Vite bridge and SDK so recovery conflicts and storage failures retain their intended behavior. Enforce annotation page isolation in the feedback store for both HTTP entry points. Make repeated SDK mounts await initialization and prevent stale preference caches from overriding newer local changes when storage writes fail.

  Separate DOM subscription management from selection state and avoid full-document shadow-root rescans for ordinary style and text updates.

- 47350c0: Isolate marker and feedback-editor interactions before host document capture handlers can dismiss menus and redirect clicks to underlying elements. Preserve native text editing, image picking, keyboard activation and Alt passthrough for mouse and touch input.
- ba14fbb: Configure the service-directory deny rules before Vite compiles its filesystem matcher. This prevents access through /@fs when a custom Ainotation service directory is inside the host's allowed filesystem roots, including on Linux. Preserve Vite's default sensitive-file restrictions.

  Wait for the browser to commit hidden editor controls before extracting a screenshot frame, improving capture consistency on slower machines.

- Updated dependencies [5afa2bc]
- Updated dependencies [d994c13]
  - @ainotation/schema@1.0.0-beta.1

## 1.0.0-beta.0

### Major Changes

- Prepare the first public 1.0.0 beta release of Ainotation. Publish the SDK, shared feedback schema, local MCP service and Vite plugin as coordinated @ainotation packages, with built entry points, package documentation and explicit licensing.

  Provide automated validation, Changesets version pull requests and npm trusted publishing through GitHub Actions. Development and non-commercial use are permitted under the included license; commercial distribution, services and production integration require separate written authorization.

### Minor Changes

- Add Simplified Chinese, Traditional Chinese, English, Japanese and Korean interface languages, selectable in Settings and persisted per project. Match the browser's language preferences on first use, including Chinese script/region variants, with English fallback.

  Use complete, type-checked TypeScript dictionaries and SDK-instance language state with no new runtime dependencies. Update the inspector, settings, marker editors, drawing tools, tooltips, accessibility labels and typed error/status messages without resetting drafts, images, drawing state or undo history. Keep feedback content and machine-readable handoff identifiers unchanged.

- 400aa48: Deliver milestone one: persistent DOM annotations and structured feedback handoff.

  - Add a framework-independent SDK with lazy mounting, a draggable trigger and toolbar, and in-place markers for creating, editing, and deleting feedback. Support Shift multi-selection, native disabled controls, Option/Alt interaction passthrough, text selection annotations, and Command/Super + Enter to save.
  - Persist annotations and drafts per project and full page URL in IndexedDB. Restore markers across route changes, and remember the shared toolbar position, output detail preference, and light/dark theme across remounts and refreshes.
  - Capture bounded DOM ancestry, nearby elements and text, semantic attributes, computed styles, selection quotes, and page environment. Provide Compact, Standard, Detailed, and Everything Markdown output, with project-wide copying grouped by URL and current-page JSON export and clearing.
  - Define shared validated feedback contracts and JSON Schema, retaining complete snapshots in persistence, JSON exports, and MCP responses. Keep the internal conversation and processing-status model out of the public annotation workflow.
  - Add a standalone MCP service with schema discovery, session listing, and annotation CRUD. Provide persistent storage, authenticated loopback HTTP/SSE synchronization, exact Host/Origin validation, retry deduplication, and deletion tombstones.

- 6bd9b09: Deliver milestone three: image annotations, live page drawing and cropped screenshots attached to feedback.

  - Start drawing from a marker's Screenshot action, or import PNG/JPEG/WebP images by pasting, dropping or choosing a file. Support arrows, rectangles, ellipses and pen strokes, six preset colors, seven line widths, tooltips and editor-scoped shortcuts.
  - Add a single handle for resizing and rotating shapes, marquee and Shift selection, grouped movement/deletion/styling, and undo/redo that restores selection. Keep crop regions editable and map them to the actual image resolution; crop before downscaling and exclude editor controls from the output.
  - Hold Option/Alt to interact with the host page. Isolate drawing, toolbar and palette pointer events so host menus retain focus and stay open through confirmation. Support native modal/popover placement and clean up capture streams, image bitmaps and object URLs when the editor closes.
  - Save PNG attachments atomically with local feedback drafts in IndexedDB. Provide thumbnail editing and hover actions for download/removal; keep feedback confirmation actions aligned to the right with a destructive delete style.
  - Transfer image bytes through authenticated project- and session-scoped endpoints and retrieve PNG content on demand through ainotation_get_image. Keep image metadata in feedback JSON, enforce attachment identity and size limits, and apply feedback updates independently of attachment transfer success.
  - Export pages with images as a ZIP containing JSON, Markdown and PNG files; retain JSON-only export for pages without images. Automatically fit generated screenshots within pixel and byte limits, and fall back to the playing video when ImageCapture frame extraction is unavailable or fails.

- 04b3de7: Deliver milestone two: automatic development integration and workspace-scoped MCP feedback.

  - Add a Vite/Vite+ plugin that declares projects with a name and optional stable id, automatically mounts the SDK in development, and connects through an authenticated same-origin proxy. Standard integration requires no identity file, initialization command, or manually entered endpoint and token. Production builds omit the tool.
  - Add a shared local service with project registration, independent persistent stores, renewable project-scoped browser and Agent credentials, and connection discovery. Keep legacy identity files, UUIDs, and manual server entry points compatible.
  - Add a stdio MCP connection command with workspace roots and directory resolution. Discover Web apps with ainotation_list_projects and select each operation's project by name, stable key, or UUID; return candidates for ambiguous selections and exclude other workspaces.
  - Manage credential acquisition, renewal, revocation, shutdown, and late responses through a common lifecycle. Cancel pending browser pairing when synchronization stops and reject redirects during feedback synchronization.
  - Make Playground use automatic integration by default, and add React and Vue sample applications with multi-project browser-to-MCP coverage.

### Patch Changes

- Unify Ainotation's light and dark themes using Happy Hues palettes 5 and 10. Apply mint/teal surfaces, forest/mint text, warm gold primary actions and coral danger states across the launcher, toolbar, settings, markers, image editor and tooltips.

  Separate primary action colors from focus, selected, success, danger and drawing-guide colors. Theme DOM selection overlays and drawing guides consistently, while retaining the actual colors of user-created image annotations. Validate text and primary-action contrast in both themes.

- Updated dependencies
- Updated dependencies [400aa48]
- Updated dependencies [6bd9b09]
  - @ainotation/schema@1.0.0-beta.0
