# P11 — Manual screen capture and markup

## Boundary

This is an explicit user action, never Recall capture, periodic monitoring, recording, OCR, automatic provider input, or external sharing. The source image stays local unless the user explicitly invokes an existing approved lifecycle action.

## Acceptance criteria

1. macOS and Windows expose truthful screen permission/readiness plus window, display, and region workflows through packaged native Electron capture paths. Region is a user crop immediately after a selected display capture. No capture occurs until the user starts it.
2. A configurable curated global shortcut and default mode are available in Settings and through non-security domain commands. Registration failure is visible and fails closed.
3. A compact capture sheet provides source selection and quick Copy, Save, Annotate, Add to Chat, Add to Knowledge, and Discard actions.
4. The local editor supports crop; select/move/resize; arrow, line, rectangle, ellipse; text; numbered callouts; highlight; freehand; blur, pixelate, irreversible redaction; undo/redo; color and stroke controls. Layers remain editable until a deliberate flattened export/update.
5. Captures have workspace, device, source/mode, timestamp, dimensions, digest, retention, annotation, and derived-object provenance. Storage is bounded; expiry/delete cascades source bytes and derivatives; backup/restore/sync preserve the chosen local lifecycle without implicit provider/relay transmission.
6. Chat/Knowledge attachment is explicit. Browser screenshots may be imported into the same editor. Image analysis occurs only through an explicitly requested and capable chat provider.
7. Focused tests, full tests/lint/type/build, macOS package/runtime closure and real harmless GUI acceptance pass. Independent review leaves no unresolved blocker/high. Windows-native permission/picker validation remains an explicit hardware gate.

Deferred without being dropped: scrolling capture, pin-to-screen, screen recording/GIF, and polished background/export presets.
