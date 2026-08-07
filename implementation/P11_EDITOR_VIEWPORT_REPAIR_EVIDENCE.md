# P11 annotation editor viewport repair — evidence

Status: complete on 2026-08-07; final independent review 0 blocker / 0 high / 0 medium.

## Reproduction and repair

The normal-profile macOS package reproduced the regression at a 1180×650 window: the editor header, tool rail, property rail, and canvas exhausted the clipped modal height, leaving the primary footer below the viewport. The editor had independent `max-height` calculations rather than one layout owner.

The editor is now a bounded five-row grid: header, horizontally scrollable tool rail, horizontally scrollable property rail, `minmax(0, 1fr)` canvas viewport, and persistent action footer. Only the canvas and compact rails can scroll. The footer provides keyboard-reachable **Discard changes**, **Save layers**, and **Done · flatten** actions and respects the bottom safe-area inset. No capture, persistence, privacy, or black-frame pipeline code changed.

## Verification

- Focused UI/capture gate: 11/11 tests.
- Full gate: 117 suites / 516 tests; TypeScript/Vite build; lint 0 errors (nine pre-existing hook warnings); macOS arm64 package closure.
- Real normal-profile packaged measurements:
  - Short 1180×650 window (1180×618 content viewport): editor y=34–584, canvas y=201–528, footer y=528–583; document scroll height equals viewport height.
  - Narrow practical app minimum (840×618 content viewport): editor y=25–593, canvas y=193–537, footer y=537–592; all three action buttons fit and document scroll height equals viewport height.
  - Fullscreen 1512×949: editor y=35–915, canvas y=231–851, footer y=851–914; document scroll height equals viewport height.
- Visual artifacts captured during the gate: `/tmp/waypoint-editor-before.png`, `/tmp/waypoint-editor-after-short.png`, and `/tmp/waypoint-editor-after-narrow.png`.

The gate used the workspace-bundled Node 24.14 with npm `--force` because the checkout declares Node 24.15/npm 12 and those exact versions were unavailable locally; every validation command itself completed.

The independent reviewer found no blocker/high issue. Its medium finding—that **Done · flatten** did not close after a successful irreversible flatten—was repaired so completion now returns to the prior capture surface. A narrow selector that unnecessarily gave the general capture sheet fixed height was also repaired. Final re-review is 0 blocker / 0 high / 0 medium. The only evidence note is that fullscreen was measured at 1512px rather than on separate ultrawide hardware; the editor's 1220px cap and centered grid behavior are deterministic at wider viewports.

The final rebuilt package repeated the 1180×650 check: footer y=528–583 within the 618px content viewport, editor `scrollHeight` equaled `clientHeight` (548px), and **Done · flatten** persisted successfully, closed the editor, and returned to the capture surface.
