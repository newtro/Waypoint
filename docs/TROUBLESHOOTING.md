# Troubleshooting

Start with a disposable workspace and a fresh export of any important data. Do not delete the application-data directory as a troubleshooting step.

## The app does not open on macOS

The current development package is unsigned and not notarized. Open it from Finder's context menu and review the macOS warning. Do not disable Gatekeeper globally. If the package is damaged or built for a different architecture, rebuild from source on the target Mac or wait for a signed release.

## Local content or search looks wrong

- Confirm the selected workspace in the header.
- Restart Waypoint and retry ordinary text search.
- Semantic search is a separate derived index; re-index the note after edits.
- Export the workspace before attempting recovery.
- Do not edit `waypoint.sqlite`, its WAL files, or managed attachment files while Waypoint is running.

If disk space is low, free space outside Waypoint first. Do not manually remove attachment or database files; deletion must pass through Waypoint so owned indexes and relationships are removed consistently.

## Semantic search fails

Semantic search requires a separately installed Ollama process and the configured local embedding model. Confirm Ollama is running on its loopback endpoint and that the model is installed. Waypoint intentionally rejects remote, authenticated, or non-loopback Ollama URLs. Text search remains available without Ollama.

## Codex or Claude Code is unavailable

1. Open a terminal and verify the CLI is installed on `PATH`.
2. Use the CLI's own normal status/sign-in flow; do not paste credentials into Waypoint.
3. Restart Waypoint after installing, updating, or reauthenticating the CLI.
4. Check the route and conservative security profile shown in the chat workbench.

Waypoint invokes the resolved executable directly without a shell, passes prompts over standard input, bounds output and duration, and stores terminal failure state. A missing, expired, or incompatible CLI should not damage the workspace. Local authoring works when either or both CLIs are unavailable.

## A run appears interrupted

Refresh the chat and inspect its execution status. Cancellation, timeout, startup failure, and application shutdown are terminal states. Do not assume a provider completed work that Waypoint did not record as complete. Retry deliberately; avoid repeatedly launching the same write-capable task.

## Export or restore fails

- Confirm the destination is writable and has free space.
- Treat the archive as plaintext sensitive data.
- Restore an unmodified archive produced by Waypoint; do not hand-edit JSON.
- Restore creates a new workspace rather than overwriting the existing one.
- Preserve both the source workspace and original archive until the restored copy is verified.

## Sync or device enrollment does not work

Production sync is not connected yet. The repository contains a locally verified protocol, storage, and opaque-relay foundation only. There is no supported real Ubuntu/AWS endpoint, TLS setup, account connection, or desktop enrollment workflow to repair in the current build.

## Windows-specific failures

Windows-native build, package, launch, filesystem, process-control, protected-storage, and update verification is still mandatory and platform-contingent. Record the exact OS/build and tool versions; do not infer a fix from macOS behavior.

There is no automatic telemetry or diagnostic upload. Any log, archive, screenshot, or system detail leaves the device only when the user deliberately shares it; review it for sensitive content first.
