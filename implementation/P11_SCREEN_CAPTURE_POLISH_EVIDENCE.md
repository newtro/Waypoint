# P11 screen capture visual polish — evidence

Status: clean on 2026-08-06.

## Packaged inspection

The normal-profile macOS package was inspected before and after at normal, ultrawide/maximized, short, and emulated narrow viewport sizes. The real global shortcut opened the capture sheet while another app was focused. The packaged source chooser enumerated both displays. A harmless user-triggered display capture reached the final Screenshot Ready preview and the same capture opened in the final editor.

The before-state exposed unstyled quick-action buttons, weak hierarchy, tiny utility controls, and no capture preview. The final state has:

- a quiet viewfinder signature, segmented region/window/display selector, framed source previews, and purposeful local-only copy;
- a bounded visual Screenshot Ready preview with clear primary/secondary/destructive actions;
- a dark precision-canvas workbench, grouped tools and properties, distinct privacy tools, polished history/empty/error states, and responsive Settings controls;
- visible focus, trapped modal tab order, reduced-motion behavior, and a keyboard-equivalent annotation path for adding/selecting/moving/resizing/deleting layers.

## Gate

- Focused: 3 suites / 13 tests.
- Full: 117 suites / 514 tests.
- TypeScript clean; ESLint 0 errors (9 pre-existing hook warnings); production build and diff hygiene clean.
- macOS arm64 package and packaged runtime/platform closure passed. The package remains unsigned because no valid Developer ID Application identity is installed.
- Independent review: initial 0 blocker / 2 high / 3 medium / 1 low. The missing ready thumbnail and pointer-only canvas were repaired. Final focused re-review: **0 blocker / 0 high**.

Windows Print Screen/default-conflict behavior remains implemented and unchanged; native Windows visual validation remains the physical-Windows gate.
