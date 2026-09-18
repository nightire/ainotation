# @ainotation/mcp

Storage recovery commands: `ainotation-mcp doctor`, `ainotation-mcp repair`, and
`ainotation-mcp backup --to DIRECTORY --keep 3`. The service repairs missing live
state, retains validated JSON backups, and coordinates outside its data directory.
See [recovery documentation](https://github.com/nightire/ainotation/blob/main/RECOVERY.md).

Local MCP service for Ainotation feedback and PNG attachments. Requires Node.js
24.20+; the HTTP service binds to loopback and uses project-scoped authentication.

Configure an MCP client in your workspace with:

```json
{
  "command": "npx",
  "args": ["--yes", "@ainotation/mcp@beta", "connect"]
}
```

Start your web app with `@ainotation/vite` to register it. The MCP connection finds
projects within the client's workspace roots. `ainotation_list_projects` discovers
apps; a per-call `project` argument selects an app when more than one is available.

Use `ainotation_get_image` to read an attachment by its session and image IDs.
See the [project documentation](https://github.com/nightire/ainotation#readme) for
the complete CLI, tool list and legacy manual pairing options.

## Shared style suggestions

Feedback includes `targetStyles`, keyed by target identity. Markers reference the
same record through their target ID or `styleTargetId`; inline `styleChanges` are
expanded projections for compatibility. Updating a target's `styleChanges` through
annotation CRUD updates all markers sharing it. Use an empty array to remove that
target's suggestions. Deleting a marker retains styles until the last reference
is removed. Both `styleSuggestions` and `sharedStyles` are advertised in the
authenticated `/health` response's `capabilities` and on sync responses. The SDK
checks capabilities before sending style mutations, including through the Vite
bridge, so older services cannot strip new data or consume pending operation IDs.

## License

MIT licensed, free for personal and commercial use, including modification,
redistribution, hosted services and proprietary integration. Retain the copyright
and license notices. See LICENSE for complete terms.
