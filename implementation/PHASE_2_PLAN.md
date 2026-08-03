# Phase 2 plan — AI workbench alpha

## Scope

Build visible, constrained local execution through the user's existing signed-in Codex and Claude Code CLIs. Runs belong to durable chats and expose route, executable/version, model when selected, local device, named security profile, status, timing, failure, and bounded parent/child lineage.

Phase 3 sync/peer execution, third-party accounts, schedules, unrestricted tools, and deployment remain out of scope.

## Security profile

The default profile is workspace-rooted, read-only, provider-network-only, no tools, no injected secrets, local-only, explicit approval, one concurrent run, and a two-minute ceiling. Adapters resolve an exact binary, do not use a shell, send prompts over stdin rather than argv, inherit only PATH/HOME/USER/LANG plus NO_COLOR, bound output, and use each CLI's non-persistent safe flags. `HOME` and `USER` are the minimum residual required to reach existing CLI sign-in state on macOS; Waypoint never reads or persists credentials.

## Gate

- Both versioned adapters normalize structured text/tool/diagnostic events.
- Completion, startup failure, nonzero exit, cancellation, timeout, and output limit are terminal and durable.
- Assistant output and successful terminal provenance commit atomically.
- Renderer access remains narrow IPC; CLI output cannot grant capabilities.
- Chat/workspace deletion cascades executions and events.
- Local tests, lint, build/package and authorized live CLI checks pass.
- Independent review has no unresolved blocker/high finding.
