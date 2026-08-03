# Phase 1 responsive layout regression

## Defect and repair

The packaged workspace shell used `max-width: 1240px`, so maximizing the macOS window enlarged only the background. The shell now fills the viewport, uses fluid padding/gaps, permits header/action wrapping, prevents grid/card minimum-content overflow, and changes to a single-column workspace at 980px so the Electron minimum window remains usable. The cartographic palette, typography, texture, and Phase 1 behavior are unchanged.

## Verification

- Vitest: 8 files, 51 tests, including focused viewport, breakpoint, flex-shrink, wrapping assertions.
- ESLint: pass.
- TypeScript/Vite production build: pass.
- Native macOS arm64 directory package: pass.
- Packaged native window/web-content geometry:
  - 840 × 620 window → 840 × 588 web content.
  - 1180 × 760 window → 1180 × 728 web content.
  - 1536 × 930 maximized bounds → 1536 × 898 web content.
- Screenshot capture was unavailable to the local process, so no screenshot-based claim is made; native accessibility geometry and the focused CSS contract provide the recorded evidence.

## Review

Independent adversarial review confirmed the original maximized-width repair, then found that card flex children could retain content-based minimum widths at the compact breakpoint. The children now explicitly shrink and long unbroken content wraps; focused assertions cover the exact rules. Final re-review found no unresolved blocker/high finding, so the scoped gate is clean.
