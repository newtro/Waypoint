# Getting started on Windows

Waypoint is designed as a native, Docker-free Windows desktop peer, but Windows-native build, package, launch, update, filesystem, process-control, and protected-storage verification is still platform-contingent. Do not treat the current macOS evidence as Windows release evidence.

## Packaged runtime

Once a Windows-verified package is produced, the installed application should not require Node.js, npm, Docker, or a coordination server for its local workspace features. No Windows package is claimed ready by the present Mac-local gate.

Before using a future Windows package with important data:

1. Verify its publisher and checksum through the eventual official release channel.
2. Create a disposable workspace.
3. Confirm restart persistence, export/restore, attachment handling, semantic-index deletion, and CLI cancellation.
4. Repeat the two-peer and stale-delete matrix before enabling sync.

For a hands-on evaluation through the installed UI, copy the [Windows packaged-app acceptance prompt](WINDOWS_PACKAGED_APP_ACCEPTANCE_PROMPT.md) into Waypoint and record the actual pass, fail, and unavailable results.

Windows code signing and the production publishing/update channel are deferred.

## Build from source on Windows

The intended native source path requires Node.js 22 or newer, npm, Git, and the repository checkout. It must not require WSL or Docker.

```powershell
npm install
npm test
npm run lint
npm run build
npm run package:dir
```

These commands describe the repository's intended build path; they are not a substitute for the required Windows-native verification matrix. Record the exact Windows, Node, npm, Electron, Codex CLI, and Claude Code CLI versions when that matrix runs.

## Optional capabilities

- Ollama must be installed natively on Windows for semantic search and must remain on a loopback endpoint. Text search works without it.
- Codex and Claude Code must be installed and signed in independently. Waypoint reuses their existing sessions and does not own their credentials.
- The real Ubuntu/AWS coordinator, TLS, enrollment, recovery, and end-to-end desktop wiring are not yet available as a supported setup path.

Until Windows-native verification is complete, use the Mac-local build for evaluation and keep Windows as a mandatory deferred release gate.
