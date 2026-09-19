# @ainotation/mcp

## 1.0.0-beta.3

### Minor Changes

- c6dd24a: Add client-independent UI Variants exploration. Request alternative designs from a saved annotation, compare an original and up to six coordinated candidates, and persist explicit accept/regenerate/cancel decisions for the agent to read when the user asks it to continue. Generation/revision checks protect newer decisions, and the service enforces one active exploration per project and full page URL.

  Provide a framework-independent host store with explicit target bindings, structural single-branch rendering, HMR cleanup, multi-target validation and failed-switch rollback. The Vite virtual entry provides a production original-only fallback; candidate implementations and styles remain development-gated host code. Preserve original feedback snapshots and pause related style overrides without losing their drafts.

  Use compact previous/next navigation with the current design and a page indicator including Original. Center the controller near the bottom by default, support blank-area dragging and keyboard positioning, and remember the last position locally per project/full URL with viewport clamping. Keep input and touch scrolling native and prevent accidental actions after dragging.

  Allow minimizing the controller to a draggable title row without changing the active design, discarding feedback or resuming page picking. Expanding restores its previous content.

  Place Cancel last in the footer with destructive styling and require dialog confirmation. Keep comparing and Escape preserve exploration; state changes dismiss stale confirmations. Keep only minimize/expand in the header.

  Reset the annotation's toggle when cleanup completes and allow explicitly starting a fresh exploration on that same annotation. Preserve ordinary completed-record edits, distinguish fresh draft intent from stale enabled flags after reload, and protect restarts against outdated completion snapshots and concurrent page ownership.

  Retain independent variant cleanup records when unfinished exploration annotations are deleted or cleared. Return previews to Original, show a persistent cleanup reminder, preserve context through sync/restart/recovery, and let agents discover and complete cleanup using the deleted annotation ID. Keep page ownership until completion, reject stale publication and completion, and require the `uiVariantsCleanup: 1` capability before syncing cleanup records to avoid data loss with older services.

  Acknowledge stale deleted-annotation edits before resolving exploration conflicts so they cannot block subsequent sync operations. Restore owned hosts to Original on cancellation or deletion even when HMR leaves duplicate registrations or a newer round has no matching host module.

  Temporarily suspend page picking, selection outlines and markers while comparing a published generation so candidates can receive native interactions without Alt. Keep the controller and annotation editor usable, preserve the user's picking choice and manual Alt behavior, and restore selection after a decision or when leaving the exploration. Cancel interrupted picking gestures and preserve native gestures across the transition.

  Expose versioned integration guidance as an MCP resource and tool, include exploration instructions in feedback reads, and add candidate registration/state/completion tools. Browser readiness and agent-reported cleanup are distinct from user decisions. Older services are checked before any variant-bearing sync, with local data retained. Add five-language UI, Storybook examples, and real DOM/React/Vue integration coverage.

### Patch Changes

- Updated dependencies [c6dd24a]
  - @ainotation/schema@1.0.0-beta.3

## 1.0.0-beta.2

### Minor Changes

- 5074d35: Add style suggestions to the annotation workflow. Edit common CSS properties with live preview, linked padding, numeric wheel and keyboard adjustment, undo/redo and per-property reset while retaining text and image feedback. Preserve original snapshots and store each target's original/desired declarations in drafts, annotations, all Markdown output levels, JSON/ZIP exports and MCP context.

  Manage shared styles per page target with a global toolbar preview switch and per-target inclusion controls. Multiple markers on the same element share drafts and saved suggestions; multi-target markers support mixed values, relative numeric adjustment and atomic batch undo. Saving and closing retain the full page preview, cancellation restores committed values, and deleting the last reference removes shared suggestions. Navigation and teardown restore host styles without overwriting newer declarations. Changed styles require confirmation and missing/replaced targets retain strict identity checks. Pause synchronization against services lacking shared-style support. Include the integrated panel in Storybook and support all five interface languages.

  Remember each marker's editor tab, dragged position and target scope across save/reopen/reload. Preserve the scope through parent/child navigation, recover initially hidden or deferred targets when their DOM becomes available, and close an open editor before an ordinary outside click can create another marker.

  Persist each editor selection item's navigation path separately from the complete set of related style targets. Reopening or refreshing retains the original parent/child navigation experience while explicit multi-selections stay parallel. Validate restored paths against live node identity and parent relationships; retain the existing target-list fallback for older or incompatible editor context.

  Move annotation editors by dragging non-interactive blank areas instead of a dedicated handle. Preserve native input, selection and scrolling interactions, and use outside clicks to close the editor without an extra minimize button.

  Group padding and margin separately with default all-side inputs and expandable horizontal/vertical or individual-side controls. Mode switches preserve existing values; grouped numeric edits, relative steps and resets remain atomic across sides and selected targets.

  Check service style capabilities through an authenticated read-only health request before sending mutations, including through the Vite development bridge. Clear persisted style drafts with deleted target references and page clearing, preserve new host writes during synchronous snapshot capture, and allow navigation among existing targets at the annotation limit.

### Patch Changes

- a55c3ab: Adopt the MIT License, removing the previous commercial-use restrictions. Permit personal and commercial use, modification, distribution, hosted services and proprietary integration under the standard MIT terms. Update package metadata and documentation, include the complete MIT text in every published package, and retain bundled third-party license notices. Previously published beta.0 and beta.1 archives retain their original license text.
- Updated dependencies [5074d35]
- Updated dependencies [a55c3ab]
  - @ainotation/schema@1.0.0-beta.2

## 1.0.0-beta.1

### Minor Changes

- d994c13: Recover missing service state through an independent instance coordinator, repair loaded snapshots, retain JSON backups, and add doctor/repair/external-backup commands. Introduce storage epochs and missing-image negotiation, pause conflicting recovery before replacing browser feedback, and add project restoration and version-choice controls with retained local copies. Protect coordinator credentials from Vite file serving.

### Patch Changes

- 5afa2bc: Share typed sync diagnostics across the service, Vite bridge and SDK so recovery conflicts and storage failures retain their intended behavior. Enforce annotation page isolation in the feedback store for both HTTP entry points. Make repeated SDK mounts await initialization and prevent stale preference caches from overriding newer local changes when storage writes fail.

  Separate DOM subscription management from selection state and avoid full-document shadow-root rescans for ordinary style and text updates.

- Updated dependencies [5afa2bc]
- Updated dependencies [d994c13]
  - @ainotation/schema@1.0.0-beta.1

## 1.0.0-beta.0

### Major Changes

- Prepare the first public 1.0.0 beta release of Ainotation. Publish the SDK, shared feedback schema, local MCP service and Vite plugin as coordinated @ainotation packages, with built entry points, package documentation and explicit licensing.

  Provide automated validation, Changesets version pull requests and npm trusted publishing through GitHub Actions. Development and non-commercial use are permitted under the included license; commercial distribution, services and production integration require separate written authorization.

### Minor Changes

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

- Updated dependencies
- Updated dependencies [400aa48]
- Updated dependencies [6bd9b09]
  - @ainotation/schema@1.0.0-beta.0
