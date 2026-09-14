# @ainotation/vite

Development-only Vite integration for Ainotation: DOM feedback, live drawing,
screenshots and a local MCP connection. Node.js 24.20+ and Vite 7/8 are supported.

```sh
pnpm add -D @ainotation/vite@beta
```

```ts
import { defineConfig } from 'vite';
import { ainotation } from '@ainotation/vite';

export default defineConfig({
  plugins: [ainotation({ name: 'my-app' })],
});
```

The plugin automatically mounts the inspector and pairs it through the local
development server. Production builds omit Ainotation. Configure your MCP client
to run `npx --yes @ainotation/mcp@beta connect` in the workspace.

See the [project documentation](https://github.com/nightire/ainotation#readme) for
multiple projects, image annotations, configuration and troubleshooting.

## License

Source available under the included Ainotation Development and Non-Commercial
License. Internal development and debugging, including for commercial projects,
are free. Commercial distribution, hosted services and production integration of
Ainotation require separate written authorization. See LICENSE for complete terms.
