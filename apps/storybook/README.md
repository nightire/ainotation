# Storybook

Run `vp run storybook` from the repository root, then open http://127.0.0.1:6006/.

## Style editor prototype

For the integrated SDK, open **Annotations → Style Editor → Live**. This story
uses the actual local-only runtime, storage, image editor and marker panel;
annotations survive reopening the story. **Dark** exercises the same UI theme.
Use the toolbar eye switch for the entire page, or the Styles switch for the
current selection. Save/close retains previews. Shift-select both sample buttons
to try mixed values and batch edits; create another marker on one button to edit
its shared styles through either marker. Only deleting the last reference removes
the target's saved suggestions. Navigation/unmount restores host styles.
The prototype below remains available as an interaction reference.

Open **Prototypes → Style Editor → Playground** to try the proposed annotation
style editor. It opens with the familiar compact feedback panel: selector copy,
locator details, a blank textarea, screenshot/import actions, and icon-only
cancel/save/delete controls. Feedback First, Styles First, Dark and Multiple
Targets offer alternative entry states.

- Click the sample button, heading or card to change targets; use the panel's
  parent/back buttons to navigate between the button and its container.
- Switch between Feedback and Styles without losing the draft. Edit common CSS
  values, choose colors, expand property groups and link padding on all sides.
- Import, paste or drop PNG/JPEG/WebP images. The existing SDK drawing editor
  handles editing and cropping. Thumbnails support re-editing, downloading and
  removal. Screenshot uses real screen sharing and requires browser permission;
  open the story in a new tab if the embedded browser blocks the capture picker.
- Text, images and style suggestions save together. Command/Ctrl+Enter saves;
  Escape cancels. Saved annotations also expose the original delete action.
- Toggle live preview, click a field's yellow dot to restore it, undo/redo, or
  restore all edits. Reset dots also support keyboard activation.
- Numeric fields support arrow keys and the wheel while focused with the pointer
  inside the input. Scroll up to increase and down to decrease; Shift uses a 10×
  step. Units are retained, rem/em and unitless line-height use 0.1 steps, and
  opacity uses 0.05. Unfocused fields and non-numeric values keep normal scrolling.
  Shift's horizontal wheel deltas are accepted too. Active numeric adjustments
  isolate the wheel from container/page scrolling, and the property viewport
  disables scroll anchoring so revealing original values does not move the input.
- Drag the grip to move the panel on desktop, or focus it and use arrow keys.
  On narrow screens the panel follows the sample in normal document flow.
- Save to inspect the original/desired values and illustrative handoff JSON.
  Saving and cancelling restore the sample. Reopening saved feedback starts with
  preview off; cancelling another edit preserves the saved suggestion.

**保存与恢复 · 交互验证** tests styles, original-state preview, parent navigation,
undo/redo and cancellation. **反馈与附件 · 交互验证** tests the actual drawing
editor, upload/paste/drop, attachment preservation, keyboard save and deletion.

This is a Storybook-only prototype with in-memory state and a controlled sample
DOM. Reloading resets it. Its illustrative JSON is not a new SDK/MCP contract;
arbitrary host DOM reconciliation, persistence and production localization are
outside this prototype. Third-party resources and CSS custom
property expressions are intentionally excluded from the sample inputs.
