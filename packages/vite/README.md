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

## UI Variants host integration

Development host code can import `defineVariants` from `virtual:ainotation/variants`.
The plugin resolves the SDK helper without requiring a direct SDK dependency in
the host. Add this reference in your `vite-env.d.ts` for TypeScript:

```ts
/// <reference types="@ainotation/vite/variants" />
```

The same virtual module resolves to an original-only no-op store during a build;
it never starts the inspector or service. Candidate implementations and CSS should
be dynamically imported under `import.meta.env.DEV` so they are also eliminated
from production output. See the SDK README and MCP `ainotation_get_variants_guide`
for subscription, explicit target binding, generation and cleanup requirements.

## License

MIT licensed, free for personal and commercial use, including modification,
redistribution, hosted services and proprietary integration. Retain the copyright
and license notices. See LICENSE for complete terms.
