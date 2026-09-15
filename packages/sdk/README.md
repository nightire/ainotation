# @ainotation/sdk

Framework-independent DOM annotations, image feedback and a Lit/Shadow DOM
inspector. Includes five interface languages and light/dark themes.

Most Vite projects should use [`@ainotation/vite`](https://www.npmjs.com/package/@ainotation/vite)
for automatic development-only injection and MCP pairing. The SDK also supports
manual integration; see the [project documentation](https://github.com/nightire/ainotation#readme).

```sh
pnpm add -D @ainotation/sdk@beta
```

Lit is provided by the SDK; hosts do not need to configure a rendering framework.
Feedback is saved locally. Screenshots require browser authorization; existing
PNG/JPEG/WebP images can also be pasted, dropped or selected.

For an explicitly local-only instance:

```ts
import { createAinotation } from '@ainotation/sdk';

const inspector = createAinotation({ projectId: 'my-app', mcp: false });
await inspector.mount();
```

`mcp: false` disables MCP for this instance: it does not read or modify saved
connection credentials, start sync or accept connect/disconnect actions. Settings
shows a local-only explanation instead of connection controls or connection status.
Annotations, image attachments, copying and exporting remain available. Local
storage keeps the same project/page isolation; this option does not erase data or
change other instances. Do not combine it with `development`.

Omitting `mcp` retains manual connection and saved-credential restoration; an
`mcp: { endpoint, token }` object configures a manual connection. The Vite plugin
continues to use its automatic development bridge.

## License

Source available under the included Ainotation Development and Non-Commercial
License. Internal development and debugging, including for commercial projects,
are free. Commercial distribution, hosted services and production integration of
Ainotation require separate written authorization. See LICENSE for complete terms.
Bundled third-party components retain the licenses in THIRD_PARTY_NOTICES.
