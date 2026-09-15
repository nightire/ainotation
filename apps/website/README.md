# Ainotation website

Single-page product website with light/dark themes, English/Chinese content,
an interactive product preview and an on-demand local SDK demo.

The current design is an annotated working sheet: six columns, seven-pixel
spacing increments, marginal notes and a receipt-like handoff preview. Its creative
seed is `60bd70a28d68a4c15bb03cc34d9328bdfe711209dd6c72141fef46d2f373a031e38b0d3f81e0d659c57deeace68e1d55b201d55123ff3c5d30295241c249a9706948fa0d2218b6b3`.
The seed inspired the layout; the page does not randomize its UI on load.

```sh
vp install
vp run build:packages
vp run dev:website
```

Development URL: `http://127.0.0.1:5176/`.

`vp run build:website` generates `apps/website/dist` with the GitHub Pages base
path `/ainotation/`. The `Website` workflow deploys this directory when relevant
changes reach `main`, or when manually dispatched. Repository Pages settings must
use GitHub Actions as the build source.

Target URL: `https://nightire.github.io/ainotation/`.

The live demo loads the SDK only after an explicit click. It uses local browser
storage under a dedicated demo project and sets `mcp: false` to disable MCP,
including saved connections and the connection form in Settings.
The illustrative workspace preview is separate from that live demo.

Brand assets in `public/` are exported from the Ainotation canvas in Brilliant.
`logo.svg` (forest) and `logo-gold.svg` (warm gold) implement the Light A / Dark A
marks in the header and footer. The gold favicon is shared across both themes,
with an SVG master and PNG exports at 16, 24, 32 and 48 pixels.
The SDK embeds the same arrow/dot paths in `packages/sdk/src/ui/logo.ts`; its
launcher uses the Light B / Dark B container colors defined in `theme.ts`.
