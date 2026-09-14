---
'@ainotation/schema': minor
'@ainotation/sdk': minor
'@ainotation/mcp': minor
'@ainotation/vite': minor
---

Deliver milestone three: image annotations, live page drawing and cropped screenshots attached to feedback.

- Start drawing from a marker's Screenshot action, or import PNG/JPEG/WebP images by pasting, dropping or choosing a file. Support arrows, rectangles, ellipses and pen strokes, six preset colors, seven line widths, tooltips and editor-scoped shortcuts.
- Add a single handle for resizing and rotating shapes, marquee and Shift selection, grouped movement/deletion/styling, and undo/redo that restores selection. Keep crop regions editable and map them to the actual image resolution; crop before downscaling and exclude editor controls from the output.
- Hold Option/Alt to interact with the host page. Isolate drawing, toolbar and palette pointer events so host menus retain focus and stay open through confirmation. Support native modal/popover placement and clean up capture streams, image bitmaps and object URLs when the editor closes.
- Save PNG attachments atomically with local feedback drafts in IndexedDB. Provide thumbnail editing and hover actions for download/removal; keep feedback confirmation actions aligned to the right with a destructive delete style.
- Transfer image bytes through authenticated project- and session-scoped endpoints and retrieve PNG content on demand through ainotation_get_image. Keep image metadata in feedback JSON, enforce attachment identity and size limits, and apply feedback updates independently of attachment transfer success.
- Export pages with images as a ZIP containing JSON, Markdown and PNG files; retain JSON-only export for pages without images. Automatically fit generated screenshots within pixel and byte limits, and fall back to the playing video when ImageCapture frame extraction is unavailable or fails.
