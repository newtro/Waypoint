# Phase 1 chat UX refinement

## Scope and design

The Chats panel now uses a durable conversation layout: a cartographic “route log” sidebar lists previous workspace chats, the selected thread opens on the right, its composer continues that chat, and a prominent **New Chat** action opens creation in the conversation pane. The former left-side “start a chat” form is removed. Existing main-process persistence, workspace scoping, message ordering, deletion, and Phase 1 security boundaries are unchanged.

## Verification

- Vitest: 9 files, 54 tests. New selection tests prove active-chat preservation across refresh, deterministic fallback after deletion/initial load, and stale async refresh rejection.
- ESLint: pass.
- TypeScript/Vite production build: pass.
- Native macOS arm64 directory package: pass.
- Packaged native geometry remains responsive at the 840 × 620 minimum window and 1512 × 930 maximized window.
- Source inspection confirms the rail and thread use bounded `minmax(0, 1fr)` tracks, shrinkable text regions, wrapped message bodies, and a sub-minimum stacking breakpoint.
- Local screenshot capture remains unavailable, so no screenshot-based visual claim is made.

## Review

Independent adversarial review found a stale-response race when rapidly switching workspaces and a compact-width long-title overflow. Refreshes now use a monotonic completion gate, workspace transitions clear conversation/new-chat state before loading, and the thread heading is shrinkable with arbitrary title wrapping. Final re-review found no unresolved blocker/high finding; the focused gate is clean.
