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

## License

Source available under the included Ainotation Development and Non-Commercial
License. Internal development and debugging, including for commercial projects,
are free. Commercial distribution, hosted services and production integration of
Ainotation require separate written authorization. See LICENSE for complete terms.
Bundled third-party components retain the licenses in THIRD_PARTY_NOTICES.
