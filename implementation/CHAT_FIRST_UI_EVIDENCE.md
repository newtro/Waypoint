# Chat-first UI rework evidence

## Outcome

The primary shell now reads as a contemporary desktop AI chat product. The left rail owns New Chat, search, honest Recent/A–Z grouping, conversation selection/deletion, workspace switching, and compact knowledge/activity/health/settings entry points. The center owns the full-height transcript and one bottom composer. Knowledge opens only as a modal right drawer.

Existing CLI streaming/cancel/retry, attachment capability messaging, SQLite ownership, workspace scoping, and cascade deletion remain in place. Assistant responses can be saved atomically as provenance-linked local notes; existing notes can be edited or deleted from the invoked knowledge surface.

## Review repairs

- Restored reachable chat deletion and note edit/delete management.
- Added dialog semantics, initial focus, Tab/Shift-Tab trapping, Escape closure, and focus restoration to overlays.
- Expanded history search to message content and made A–Z a single truthful alphabetical grouping.
- Made response-to-note creation and its provenance edge one SQLite transaction.
- Added local-only window-state persistence with display identity, normal bounds, maximized state, disconnected-display selection, corrupt-state rejection, and off-screen recentering.
- Removed the narrow reading-column constraint; transcript and composer use the central pane with responsive gutters.

## Verification

- Automated: 34 test files / 171 tests; lint; TypeScript/Vite production build; high-severity dependency audit (0 vulnerabilities).
- Focused window-state tests cover valid multi-display restore, disconnected/off-screen fallback, and corrupt bounds.
- Native arm64 packaging and packaged runtime closure passed. The packaged app launched with preserved data; bounded Codex/Claude completion, failure, and cancellation checks passed without workspace writes.
- Actual packaged visual inspection passed at normal and maximized sizes, plus the invoked knowledge drawer. Evidence: `/tmp/waypoint-ui-final-normal.png`, `/tmp/waypoint-ui-final-max.png`, and `/tmp/waypoint-ui-final-knowledge.png`.
- The selected compass-orbit identity was recreated as a deterministic transparent SVG (navy geometry with blue orbit node), replacing lettermark instances in the sidebar, onboarding, and assistant identity. Packaged normal/maximized evidence: `/tmp/waypoint-logo-normal.png` and `/tmp/waypoint-logo-max.png`; no chroma-green pixels or raster background are shipped.
- Packaged macOS window-state verification reproduced a native expanded-window transition, persisted private state in userData, and reopened expanded on the same live display. A first-pass failure around native fullscreen/maximize reporting was repaired before the gate closed.
- Windows build, launch, window-state, filesystem, and process behavior remain required on Windows hardware.
