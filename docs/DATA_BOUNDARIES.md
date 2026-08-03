# Data boundaries and privacy

Waypoint is personal-first and local-first. The desktop client remains useful without a coordinator, Ollama, or either AI CLI.

## What stays on the desktop by default

- workspace SQLite data, notes, chats, messages, memories, relationships, and activity metadata;
- copied text/Markdown attachments;
- full-text and embedding indexes;
- execution provenance and durable AI output;
- local device and sync-foundation state when those foundations are exercised;
- user-created export archives.

The application database is stored under Electron's per-user application-data directory as `waypoint.sqlite`. Managed attachments are stored beside it under `attachments/`. Per-workspace CLI execution directories are created below the displayed data root under `waypoint-workspaces/<workspace-id>` and are separate from the shared database/attachment directory.

## Processes and network boundaries

- **Text search and authoring:** local only.
- **Semantic search:** optional Ollama requests go only to an unauthenticated loopback HTTP endpoint; non-loopback or credential-bearing endpoints are rejected. Embeddings remain device-local and are not synchronized.
- **AI workbench:** prompts are sent over standard input to the locally installed, signed-in Codex or Claude Code CLI selected by the user. The CLI may contact its own provider under its existing account and policy. Waypoint does not inspect or persist CLI credentials.
- **Coordinator:** only a Mac-local protocol/relay foundation exists today. No production node or ordinary desktop sync connection is active.

There is no Waypoint telemetry, analytics upload, crash upload, or background diagnostic upload in the current product. Diagnostics and exports remain local unless the user deliberately shares a file. No work or personal third-party account is connected by default.

## Deletion and retention

Deleting a document, chat, or memory removes its owned local children and derived state, including applicable revisions/messages, attachments, embeddings, full-text entries, graph edges, queued work, and execution records. The activity event is content-minimized. Synced deletion foundations use dominant tombstones to prevent stale resurrection, but the complete real-node propagation path is still deferred.

Exports and backups are independent copies. Deleting content in Waypoint cannot delete copies already exported or copied elsewhere; the user must remove those separately according to their storage provider and retention policy.

## Important current limitations

- Workspace databases and current JSON exports are not encrypted by Waypoint at rest. Use OS full-disk encryption, a protected user account, and a trusted backup location.
- Current export archives are plaintext and may contain document/chat/memory bodies, attachment bytes, activity data, and execution history.
- Release signing/notarization, Windows protected-storage validation, production key persistence/recovery, real Ubuntu/AWS/TLS integration, and a professional review of the complete sync protocol are deferred.
- Public publishing and automatic updates are not enabled.
