# Ainotation

**Visual feedback for web development and AI coding agents.**

[![npm beta](https://img.shields.io/npm/v/@ainotation/vite/beta?label=npm%20beta)](https://www.npmjs.com/package/@ainotation/vite)
[![Checks](https://github.com/nightire/ainotation/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/nightire/ainotation/actions/workflows/release.yml)

English · [简体中文](./README.zh-CN.md)

Select an element, describe what should change, and give your coding agent the context to act on it. Ainotation attaches feedback to real page elements and text selections, with DOM context and annotated screenshots available through MCP or exported files.

## Features

- **Feedback in context.** Annotate elements or text selections with selectors, styles, geometry and surrounding DOM information.
- **Draw on the page.** Add arrows, shapes and freehand strokes, select multiple shapes, and crop screenshots. Import images by pasting, dropping or choosing a file.
- **Work with AI agents.** Read and edit saved feedback through a local MCP service, including image attachments on demand.
- **Keep working locally.** Drafts and annotations survive reloads. Copy Markdown or export feedback without an MCP connection. No account or cloud service required.
- **Fit into your app.** Framework-independent UI, automatic Vite integration, and workspace-scoped project discovery for monorepos.
- **Make it yours.** Light and dark themes, keyboard shortcuts, and English, Simplified Chinese, Traditional Chinese, Japanese and Korean interfaces.

## Quick start

Requires **Node.js 24.20+ within the 24.x LTS line** and a **Vite 7/8 or Vite+** project.

### 1. Install the plugin

```sh
pnpm add -D @ainotation/vite@beta
```

The plugin includes the SDK and local service dependencies. You do **not** need to install `@ainotation/sdk` separately.

### 2. Add it to your Vite configuration

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { ainotation } from '@ainotation/vite';

export default defineConfig({
  plugins: [
    // Keep your existing framework plugins here.
    ainotation({ name: 'my-app' }),
  ],
});
```

For Vite+, import `defineConfig` from `vite-plus` instead.

### 3. Start your development server

Run your app's usual development command and open it in the browser. Click the floating **A** button, select an element, and write your first feedback.

The plugin handles injection and local pairing automatically. It is active only during development and does not inject Ainotation into production builds.

## Connect your coding agent

Add Ainotation to your MCP client. For clients that use an `mcpServers` configuration:

```json
{
  "mcpServers": {
    "ainotation": {
      "command": "npx",
      "args": ["--yes", "@ainotation/mcp@beta", "connect"]
    }
  }
}
```

The equivalent command is:

```sh
npx --yes @ainotation/mcp@beta connect
```

The client must expose the project's workspace roots or start the process in that workspace. If it does neither, append `--directory /absolute/path/to/your-project` to the arguments. Configuration syntax varies by MCP client.

Run `npx --yes @ainotation/mcp@beta --help` for CLI options.

Start the web app to register it, save some feedback, then ask your agent:

> Read the Ainotation feedback for my-app and address the requested UI changes.

The agent can discover projects, read feedback and images, and create, update or delete annotations. You can also use **Copy feedback** or **Export** to share feedback manually.

### Multiple apps in one workspace

Give each app its own project name. To keep its identity when renaming it, provide a stable `id`:

```ts
ainotation({ name: 'Admin dashboard', id: 'my-company/admin' });
```

Use `ainotation_list_projects` to discover apps and pass `project` when more than one is available. A workspace-scoped connection cannot access projects outside its roots.

## Using Ainotation

1. **Select** an element or drag across page text. Hold **Shift** to select multiple elements.
2. **Describe** the change in the marker's popover. Add a screenshot or import an image when a visual explanation helps.
3. **Save** the feedback. Click a numbered marker to edit it later.
4. **Hand it off** through MCP, copied Markdown or an export.

Hold **Option / Alt** to interact with the real page while selecting or drawing. This lets you open menus, fill fields and prepare the state you want to annotate.

Settings lets you choose the interface language, theme and Markdown detail level. Preferences are saved per project. Feedback is separated by project and full page URL.

### Screenshots and images

Choose **Screenshot** in a marker's popover to draw directly on the page, or paste, drop or choose a PNG/JPEG/WebP image. The drawing tools support moving, resizing, rotation, marquee selection, undo/redo and cropping.

Screen capture requires a supported desktop browser, a secure context such as HTTPS or localhost, and your permission. Select the **current browser tab** for live cropping. Imported images remain available as an alternative when screen capture is unsupported.

Images are attached to the draft first; save the feedback to share them. Pages with images export as a ZIP containing Markdown, JSON and PNG files. Pages without images export as JSON. Copying collects saved feedback across the current project; export and clear apply to the current page.

<details>
<summary>Keyboard shortcuts</summary>

| Context              | Shortcut                 | Action                                                 |
| -------------------- | ------------------------ | ------------------------------------------------------ |
| Inspector            | Option/Alt + Shift + A   | Open or close                                          |
| Feedback input       | Command/Super + Enter    | Save feedback                                          |
| Selection or drawing | Hold Option/Alt          | Interact with the page                                 |
| Drawing              | V / A / R / E / F / X    | Select, arrow, rectangle, ellipse, free draw, crop     |
| Drawing              | C / S                    | Cycle color / line width                               |
| Drawing              | D                        | Delete selected shapes, or clear the crop in Crop mode |
| Drawing              | Command/Ctrl + Z         | Undo                                                   |
| Drawing              | Command/Ctrl + Shift + Z | Redo                                                   |
| Drawing              | Command/Ctrl + Enter     | Capture or attach the image                            |

Drawing shortcuts apply only while the image editor is open. Each toolbar action also has a tooltip.

</details>

## Packages

| Package                                   | Purpose                                                              |
| ----------------------------------------- | -------------------------------------------------------------------- |
| [`@ainotation/vite`](./packages/vite)     | Recommended integration: development injection and automatic pairing |
| [`@ainotation/sdk`](./packages/sdk)       | Browser inspector and manual lifecycle integration                   |
| [`@ainotation/mcp`](./packages/mcp)       | Local MCP service and workspace-scoped agent connection              |
| [`@ainotation/schema`](./packages/schema) | Feedback contracts, JSON Schema and Markdown/JSON handoff            |

The project is currently in beta. Use the `@beta` npm tag for the beta channel and see [Releases](https://github.com/nightire/ainotation/releases) for release notes.

<details>
<summary>Manual SDK integration</summary>

If you need to control mounting yourself, install the SDK as a direct dependency:

```sh
pnpm add -D @ainotation/sdk@beta
```

Run this in the browser after the document is ready:

```ts
import { createAinotation } from '@ainotation/sdk';

const inspector = createAinotation({ projectId: 'my-app' });
await inspector.mount();
```

Call `inspector.destroy()` when your integration is disposed. `getDocument()` returns the current feedback snapshot; `copyFeedback()` copies saved project feedback as Markdown. For manual integration, your app is responsible for restricting the tool to development. The Vite plugin handles this automatically.

</details>

## Contributing

Bug reports, usability feedback and pull requests are welcome. Please [open an issue](https://github.com/nightire/ainotation/issues) for bugs or discuss larger changes before starting work.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, examples and checks, and [RELEASING.md](./RELEASING.md) for the Changesets release workflow.

## License

Ainotation is **source available** under the [Ainotation Development and Non-Commercial License](./LICENSE).

Internal development and debugging are free, including work on commercial applications. Commercial distribution, hosted services and production integration of Ainotation require separate written authorization from [nightire](https://github.com/nightire). Applications that do not contain Ainotation, and user-created feedback and screenshots, are not restricted merely because Ainotation was used to create them.

This is not an OSI-approved open-source license. See [LICENSE](./LICENSE) for the complete terms.
