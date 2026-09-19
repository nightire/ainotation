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

## UI Variants

The authenticated health and sync responses advertise `uiVariants: 1`. The SDK
checks this capability before sending exploration data to avoid lossy old-service
sync. Restart the service after upgrading.

Agent tools:

- `ainotation_get_variants_guide`: versioned host integration and cleanup instructions.
- `ainotation_get_variants`: current exploration, original targets, last browser
  report and user decision. Report timestamps identify observations, not a permanent
  assertion that a browser is connected.
- `ainotation_publish_variants`: register candidate metadata for an exact generation
  and revision; excludes original and does not claim preview readiness.
- `ainotation_complete_variants`: report source application/restoration and cleanup
  against the exact latest decision ID.

Mutations use a client-generated `operationId` for idempotent retries. The guide is
also available at `ainotation://guides/ui-variants/v1`; feedback reads carry a short
instruction so clients do not have to discover resources automatically. Decisions
come from the browser; the agent cannot accept candidates through these tools.
One active exploration is enforced per project/full URL across sessions. Stale
browser operations are acknowledged as conflicts rather than blocking the outbox;
stale agent writes return an error. The user explicitly asks the agent to continue.

Deleting an unfinished exploration's annotation, through browser deletion, Clear
all or MCP, records cancellation in `document.variantCleanups`. These entries keep
the former annotation ID, original page/target context and exploration metadata;
they are separate from ordinary annotations. `ainotation_list_sessions` and
`ainotation_get_feedback` expose them, while `ainotation_get_variants` accepts the
former annotation ID. Restore Original and remove generated candidates, CSS and
temporary integration, then call `ainotation_complete_variants` with that entry's
latest decision ID and revision. Cleanup keeps the page occupied until completion.
Completed entries are receipts and must not trigger repeated source edits.

Health and sync responses advertise `uiVariantsCleanup: 1`. Pending cleanup survives
service restart and browser recovery, and the SDK probes this capability before
transmitting it so older services cannot silently consume deletion operations.

## License

MIT licensed, free for personal and commercial use, including modification,
redistribution, hosted services and proprietary integration. Retain the copyright
and license notices. See LICENSE for complete terms.
