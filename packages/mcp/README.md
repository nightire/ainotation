# @ainotation/mcp

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

## License

Source available under the included Ainotation Development and Non-Commercial
License. Internal development and debugging, including for commercial projects,
are free. Commercial distribution, hosted services and production integration of
Ainotation require separate written authorization. See LICENSE for complete terms.
