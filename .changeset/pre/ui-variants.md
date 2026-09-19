---
'@ainotation/schema': minor
'@ainotation/sdk': minor
'@ainotation/mcp': minor
'@ainotation/vite': minor
---

Add client-independent UI Variants exploration. Request alternative designs from a saved annotation, compare an original and up to six coordinated candidates, and persist explicit accept/regenerate/cancel decisions for the agent to read when the user asks it to continue. Generation/revision checks protect newer decisions, and the service enforces one active exploration per project and full page URL.

Provide a framework-independent host store with explicit target bindings, structural single-branch rendering, HMR cleanup, multi-target validation and failed-switch rollback. The Vite virtual entry provides a production original-only fallback; candidate implementations and styles remain development-gated host code. Preserve original feedback snapshots and pause related style overrides without losing their drafts.

Use compact previous/next navigation with the current design and a page indicator including Original. Center the controller near the bottom by default, support blank-area dragging and keyboard positioning, and remember the last position locally per project/full URL with viewport clamping. Keep input and touch scrolling native and prevent accidental actions after dragging.

Allow minimizing the controller to a draggable title row without changing the active design, discarding feedback or resuming page picking. Expanding restores its previous content.

Place Cancel last in the footer with destructive styling and require dialog confirmation. Keep comparing and Escape preserve exploration; state changes dismiss stale confirmations. Keep only minimize/expand in the header.

Reset the annotation's toggle when cleanup completes and allow explicitly starting a fresh exploration on that same annotation. Preserve ordinary completed-record edits, distinguish fresh draft intent from stale enabled flags after reload, and protect restarts against outdated completion snapshots and concurrent page ownership.

Retain independent variant cleanup records when unfinished exploration annotations are deleted or cleared. Return previews to Original, show a persistent cleanup reminder, preserve context through sync/restart/recovery, and let agents discover and complete cleanup using the deleted annotation ID. Keep page ownership until completion, reject stale publication and completion, and require the `uiVariantsCleanup: 1` capability before syncing cleanup records to avoid data loss with older services.

Acknowledge stale deleted-annotation edits before resolving exploration conflicts so they cannot block subsequent sync operations. Restore owned hosts to Original on cancellation or deletion even when HMR leaves duplicate registrations or a newer round has no matching host module.

Temporarily suspend page picking, selection outlines and markers while comparing a published generation so candidates can receive native interactions without Alt. Keep the controller and annotation editor usable, preserve the user's picking choice and manual Alt behavior, and restore selection after a decision or when leaving the exploration. Cancel interrupted picking gestures and preserve native gestures across the transition.

Expose versioned integration guidance as an MCP resource and tool, include exploration instructions in feedback reads, and add candidate registration/state/completion tools. Browser readiness and agent-reported cleanup are distinct from user decisions. Older services are checked before any variant-bearing sync, with local data retained. Add five-language UI, Storybook examples, and real DOM/React/Vue integration coverage.
