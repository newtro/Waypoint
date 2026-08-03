# Getting started on macOS

Waypoint is a local-first Electron desktop application. The packaged application does not require Node.js, npm, Docker, or a coordination server for notes, chats, memories, text search, graph navigation, activity, export, and restore.

## Run the packaged application

The current development package is at `release/mac-arm64/Waypoint.app` after `npm run package:dir` has completed.

1. Open `Waypoint.app` from Finder.
2. If macOS blocks this unsigned development build, use Finder **Open** from the context menu and review the warning. Do not disable Gatekeeper globally.
3. Create a personal workspace. Waypoint displays its local data root in the window header.
4. Capture a note and confirm that text search finds it.
5. Use **Export** to create a recovery archive before storing important material. See [Backup and recovery](BACKUP_AND_RECOVERY.md).

Release signing and Apple notarization are deferred. The current directory package is for local evaluation, not public distribution.

## Optional local capabilities

- **Semantic search:** install and run Ollama separately, with the selected embedding model available on the default loopback endpoint. Waypoint refuses non-loopback Ollama endpoints. Ordinary text search does not require Ollama.
- **AI workbench:** install and sign in to the Codex and/or Claude Code CLI using each vendor's normal flow. Waypoint uses that existing CLI session; it does not store the CLI credential. A missing or signed-out CLI does not prevent local workspace use.
- **Multi-device sync:** a real Ubuntu/AWS coordinator is not yet connected to the desktop product. Do not enter server or account credentials expecting production sync.

## Build from source

Source development is a separate path from running the packaged app. It currently requires a recent Node.js release with `node:sqlite` support (Node 22 or newer), npm, and the repository checkout. Docker is neither required nor used.

```sh
npm install
npm test
npm run lint
npm run build
npm run package:dir
```

`npm run dev` starts the renderer development server; it is not the packaged desktop experience by itself. Use the native package for user-facing evaluation.

## Current platform status

The macOS arm64 directory package and packaged launch are part of the local verification path. Public publishing, an update channel, signing, and notarization remain deferred release gates.
