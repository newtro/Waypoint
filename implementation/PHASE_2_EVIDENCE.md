# Phase 2 evidence

Status: phase gate clean on macOS; Windows verification remains platform-contingent.

Implemented evidence:

- Production Codex/Claude process supervisor with exact-path/no-shell invocation, stdin prompts, minimized environment, safe non-persistent arguments, 8 MiB output cap, timeout, cancel, failure taxonomy, and normalized streaming events.
- Workspace-scoped conservative security profiles and durable execution/event/lineage schema migration.
- Atomic successful run completion plus assistant-message persistence; cascade through owning chat/workspace.
- Narrow IPC for capability display, profiles, run start/status/cancel, and a minimal selected-chat workbench surface.
- Unit coverage uses injected fake child processes. The separate explicit `verify:cli-live` command invokes the user's existing sign-ins only when deliberately run.
- Focused and full verification: 68 tests in 11 files, ESLint, TypeScript/Vite production build, and unpackaged macOS arm64 packaging passed.
- Native package launch passed from `release/mac-arm64/Waypoint.app`; signing/notarization remains intentionally outside this local phase.
- Authorized bounded live verification passed with Codex `0.146.0-alpha.9.2` and Claude Code `2.1.220`: both emitted `WAYPOINT_LIVE_OK`, invalid-model failure was terminal, Claude cancellation was terminal, and the isolated execution directory remained empty in every path.
- Live verification initially exposed two real compatibility defects: Codex required `--skip-git-repo-check` in a new isolated directory, and Claude streaming required `--verbose`; both were repaired. Claude macOS sign-in resolution also required the allowlisted `USER` variable.

Independent adversarial re-review found no remaining blocker or high-severity issue after the repair loops.

## Independent review repair pass

Six high-severity findings were repaired: cancellation is workspace-authorized; chat deletion and shutdown cancel active children first; startup reconciles abandoned runs; CLI detection/start failures become durable `startup_failed` rows; archive v3 round-trips profiles, runs, events, and remapped lineage while retaining v2 restore support; and the header distinguishes local storage from provider-routed AI. Non-terminal archived runs restore as interrupted failures.

The follow-up race review found a deletion window while capability detection was pending. A tested durable-start coordinator now rechecks ownership after detection, never spawns when the queued row was deleted, and cancels any spawned child if the running-state transition loses its owner. App shutdown now signals and boundedly drains supervised children before closing SQLite.

Repair verification passed: 68 tests across 11 files, ESLint, TypeScript, and the Vite production build.
