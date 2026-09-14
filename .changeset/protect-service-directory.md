---
'@ainotation/vite': patch
'@ainotation/sdk': patch
---

Configure the service-directory deny rules before Vite compiles its filesystem matcher. This prevents access through /@fs when a custom Ainotation service directory is inside the host's allowed filesystem roots, including on Linux. Preserve Vite's default sensitive-file restrictions.

Wait for the browser to commit hidden editor controls before extracting a screenshot frame, improving capture consistency on slower machines.
