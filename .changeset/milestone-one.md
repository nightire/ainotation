---
'@ainotation/sdk': minor
'@ainotation/schema': minor
'@ainotation/mcp': minor
---

Deliver milestone one: persistent DOM annotations and structured feedback handoff.

- Add a framework-independent SDK with lazy mounting, a draggable trigger and toolbar, and in-place markers for creating, editing, and deleting feedback. Support Shift multi-selection, native disabled controls, Option/Alt interaction passthrough, text selection annotations, and Command/Super + Enter to save.
- Persist annotations and drafts per project and full page URL in IndexedDB. Restore markers across route changes, and remember the shared toolbar position, output detail preference, and light/dark theme across remounts and refreshes.
- Capture bounded DOM ancestry, nearby elements and text, semantic attributes, computed styles, selection quotes, and page environment. Provide Compact, Standard, Detailed, and Everything Markdown output, with project-wide copying grouped by URL and current-page JSON export and clearing.
- Define shared validated feedback contracts and JSON Schema, retaining complete snapshots in persistence, JSON exports, and MCP responses. Keep the internal conversation and processing-status model out of the public annotation workflow.
- Add a standalone MCP service with schema discovery, session listing, and annotation CRUD. Provide persistent storage, authenticated loopback HTTP/SSE synchronization, exact Host/Origin validation, retry deduplication, and deletion tombstones.
