# P11 manual screen capture and markup — evidence

Status: implementation and non-consented package gate complete on 2026-08-06. One consented macOS acceptance step and Windows physical validation remain explicit user/hardware gates.

## Delivered

- Explicit manual-only region/window/display entry from the chat header, Settings, domain command, and global shortcut.
- macOS default `CommandOrControl+Shift+8`; Windows default `PrintScreen` / PrtSc, with curated overrides and visible registration-conflict state.
- Fresh post-hide source capture, workspace/sender-bound expiring selections, a fast Screenshot Ready action preview, browser screenshot import, and Copy / Save / Annotate / Add to Chat / Add to Knowledge / Discard.
- Layered crop, select/move/resize, arrow, line, rectangle, ellipse, text, steps, highlight, freehand, blur, pixelate, redaction, undo/redo, color/stroke, and deliberate flattening.
- Workspace-local provenance, search metadata, bounded retention, startup cleanup, backup/restore, explicit derivative provenance, sync deletion tombstones, hard cascade delete, and atomic Knowledge-link cleanup.

## Verification

- Focused: 4 files / 16 tests, then repaired 2 files / 8 tests.
- Full: 116 files / 509 tests.
- TypeScript clean; ESLint 0 errors (9 pre-existing hook warnings in `src/main.tsx`).
- Vite production build, Electron macOS arm64 package, and packaged runtime/platform closure passed.
- Independent review: initial 0 blocker / 7 high / 5 medium; first re-review 0 blocker / 2 high; final focused re-review **0 blocker / 0 high** after the quick-action preview and rollback-safe redaction boundary repair.
- Latest package launched with the normal profile as the sole Waypoint process. The macOS global shortcut opened the Capture a Screenshot modal while another app was focused. Source enumeration showed both displays and triggered the real macOS Screen Recording consent prompt, proving the permission-denied/retry boundary without bypassing consent.

## Honest remaining gates

- macOS requires the user to click **Allow** in the OS Screen Recording prompt before a real region can be captured, cropped, annotated, and saved. That consent was not automated or bypassed.
- Windows package/source code defaults to Print Screen and exposes conflict/override status. Physical Windows PrtSc ownership, native source enumeration, picker/focus, editor/save, packaging, and permission behavior remain the Windows-device acceptance gate.
- The local development package is unsigned because no valid Developer ID Application identity is installed. Signing/notarization remains a release-authority gate.

Deferred without being dropped: scrolling capture, pin-to-screen, screen recording/GIF, and polished background/export presets.
