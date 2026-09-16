---
'@ainotation/schema': patch
'@ainotation/sdk': patch
'@ainotation/mcp': patch
'@ainotation/vite': patch
---

Share typed sync diagnostics across the service, Vite bridge and SDK so recovery conflicts and storage failures retain their intended behavior. Enforce annotation page isolation in the feedback store for both HTTP entry points. Make repeated SDK mounts await initialization and prevent stale preference caches from overriding newer local changes when storage writes fail.

Separate DOM subscription management from selection state and avoid full-document shadow-root rescans for ordinary style and text updates.
