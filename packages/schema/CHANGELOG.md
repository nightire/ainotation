# @ainotation/schema

## 1.0.0-beta.1

No changes in this release.

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
