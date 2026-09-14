---
'@ainotation/mcp': minor
'@ainotation/sdk': minor
'@ainotation/vite': minor
---

Deliver milestone two: automatic development integration and workspace-scoped MCP feedback.

- Add a Vite/Vite+ plugin that declares projects with a name and optional stable id, automatically mounts the SDK in development, and connects through an authenticated same-origin proxy. Standard integration requires no identity file, initialization command, or manually entered endpoint and token. Production builds omit the tool.
- Add a shared local service with project registration, independent persistent stores, renewable project-scoped browser and Agent credentials, and connection discovery. Keep legacy identity files, UUIDs, and manual server entry points compatible.
- Add a stdio MCP connection command with workspace roots and directory resolution. Discover Web apps with ainotation_list_projects and select each operation's project by name, stable key, or UUID; return candidates for ambiguous selections and exclude other workspaces.
- Manage credential acquisition, renewal, revocation, shutdown, and late responses through a common lifecycle. Cancel pending browser pairing when synchronization stops and reject redirects during feedback synchronization.
- Make Playground use automatic integration by default, and add React and Vue sample applications with multi-project browser-to-MCP coverage.
