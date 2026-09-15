# Contributing to Ainotation

Thank you for helping improve Ainotation. Bug reports, reproduction cases, translations and focused pull requests are welcome.

## Report a problem

Before opening an [issue](https://github.com/nightire/ainotation/issues), check whether it has already been reported. Include:

- Your browser, operating system, Node.js version and Ainotation package version.
- A minimal reproduction or clear steps, with expected and actual behavior.
- Whether you use the Vite plugin or manual SDK integration.
- For capture issues, the selected source: browser tab, window or screen.

Remove private page content and credentials from shared screenshots and logs. For a larger feature or architectural change, discuss the approach in an issue first.

## Local setup

Install Node.js 24 LTS (24.20+ within 24.x), [Vite+](https://viteplus.dev/guide/) and Google Chrome. The workspace pins its package-manager and dependency versions.

```sh
git clone https://github.com/nightire/ainotation.git
cd ainotation
vp install
vp run build:packages
vp run dev
```

The Playground uses the Vite plugin to mount Ainotation automatically. Follow the URL printed by the development server.

| Command              | Purpose                        |
| -------------------- | ------------------------------ |
| `vp run dev`         | Vanilla TypeScript Playground  |
| `vp run dev:react`   | React integration example      |
| `vp run dev:vue`     | Vue integration example        |
| `vp run dev:apps`    | All three web examples         |
| `vp run storybook`   | Isolated UI component examples |
| `vp run dev:website` | Single-page product website    |

## Repository layout

```text
packages/
  schema/       Feedback contracts and handoff formats
  sdk/          DOM selection, persistence, drawing and inspector UI
  mcp/          Local service, authentication and MCP tools
  vite/         Development injection and automatic pairing
apps/
  playground/   Browser integration examples and end-to-end tests
  react/        React example
  vue/          Vue example
  storybook/    Component development
  website/      Product website for GitHub Pages
```

Implementation boundaries are documented in [AGENTS.md](./AGENTS.md). User-facing interface messages live in `packages/sdk/src/i18n/`; keep all five language dictionaries complete when adding messages.

## Before submitting a pull request

Keep changes focused, follow existing patterns and add regression coverage for behavior changes. Describe the problem, the resulting behavior and how you verified it.

```sh
vp fmt
vp run ready
```

`ready` runs formatting/lint checks, type checks, tests and builds. Browser tests require Chrome; integration tests start and clean up their own temporary services. CI validates services and packages on Linux, and browser interactions and capture on macOS Chrome.

For changes to package contents or exports, also run:

```sh
vp run release:check
```

Add a changeset for user-facing package changes with `vp run changeset`. Documentation-only changes to the repository README generally do not need a package version bump. See [RELEASING.md](./RELEASING.md) for versioning and publishing.

## License

Please review [LICENSE](./LICENSE) before using or redistributing the project. Ainotation is source available; internal development is permitted, while commercial distribution, hosted services and production integration require separate authorization. Third-party components retain their own licenses.
