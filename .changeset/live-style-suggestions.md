---
'@ainotation/schema': minor
'@ainotation/sdk': minor
'@ainotation/mcp': minor
'@ainotation/vite': patch
---

Add style suggestions to the annotation workflow. Edit common CSS properties with live preview, linked padding, numeric wheel and keyboard adjustment, undo/redo and per-property reset while retaining text and image feedback. Preserve original snapshots and store each target's original/desired declarations in drafts, annotations, all Markdown output levels, JSON/ZIP exports and MCP context.

Manage shared styles per page target with a global toolbar preview switch and per-target inclusion controls. Multiple markers on the same element share drafts and saved suggestions; multi-target markers support mixed values, relative numeric adjustment and atomic batch undo. Saving and closing retain the full page preview, cancellation restores committed values, and deleting the last reference removes shared suggestions. Navigation and teardown restore host styles without overwriting newer declarations. Changed styles require confirmation and missing/replaced targets retain strict identity checks. Pause synchronization against services lacking shared-style support. Include the integrated panel in Storybook and support all five interface languages.

Remember each marker's editor tab, dragged position and target scope across save/reopen/reload. Preserve the scope through parent/child navigation, recover initially hidden or deferred targets when their DOM becomes available, and close an open editor before an ordinary outside click can create another marker.

Persist each editor selection item's navigation path separately from the complete set of related style targets. Reopening or refreshing retains the original parent/child navigation experience while explicit multi-selections stay parallel. Validate restored paths against live node identity and parent relationships; retain the existing target-list fallback for older or incompatible editor context.

Move annotation editors by dragging non-interactive blank areas instead of a dedicated handle. Preserve native input, selection and scrolling interactions, and use outside clicks to close the editor without an extra minimize button.

Group padding and margin separately with default all-side inputs and expandable horizontal/vertical or individual-side controls. Mode switches preserve existing values; grouped numeric edits, relative steps and resets remain atomic across sides and selected targets.

Check service style capabilities through an authenticated read-only health request before sending mutations, including through the Vite development bridge. Clear persisted style drafts with deleted target references and page clearing, preserve new host writes during synchronous snapshot capture, and allow navigation among existing targets at the annotation limit.
