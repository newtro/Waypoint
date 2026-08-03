# Phase 1 verification evidence

## Implemented scope

- Guided personal workspace onboarding with an explicit local data path.
- Main-process SQLite persistence for revisioned documents, chats/messages, memories, graph relationships, supported text/Markdown attachments, activity, tombstones, and derived indexes.
- Workspace-scoped FTS5 search and optional local semantic indexing/search through a strict loopback-only Ollama provider using Qwen3-Embedding 4B.
- Narrow sandboxed renderer bridge for notes, attachments, chats, memory graph, activity, export, restore, and cascade deletion.
- Versioned JSON export with whole-archive and attachment hashes, atomic restore into fresh object identities, and lifecycle/provenance remapping; derived indexes rebuild from authored data.
- Cascade deletion stages attachment files, commits database removal/tombstone/activity atomically, restores staged files on failure, and erases them after commit. Startup reconciliation resolves interrupted add/restore/delete filesystem states.
- Immutable workspace-owned/source-owned memory semantics: source deletion detaches workspace memory provenance and cascades explicitly source-owned memories.

## Executor verification

| Check | Result | Evidence |
|---|---|---|
| Unit tests | Pass | Vitest: 7 files, 48 tests, including reopen durability, old-schema migration, workspace isolation, graph/ownership cascades, interrupted-file reconciliation, archive integrity rollback, exact embedding-generation filtering, Ollama boundary, and Phase 0 suites. |
| Lint | Pass | ESLint completed with no findings. |
| Type/build | Pass | TypeScript main/renderer and CommonJS preload compilation plus Vite production build completed. |
| Dependency audit | Pass | `npm audit --audit-level=high`: 0 vulnerabilities. |
| Native macOS package | Pass | electron-builder produced `release/mac-arm64/Waypoint.app`; code signing remains intentionally deferred. |
| Packaged launch | Pass | The packaged executable remained active during a bounded launch and emitted no Waypoint/preload/renderer error; it was then canceled. A Chromium DIPS database warning was observed and is unrelated to the app data store. |

## Defects found and repaired before review

1. Restore originally committed the empty workspace before restoring content and could orphan copied files. Workspace creation and data restore now share one database transaction, and written files are removed on rollback.
2. Object mutations initially accepted IDs from another workspace. Attachments, relationships, embeddings, and deletion now assert workspace ownership; tests prove rejection without altering the other workspace.
3. Restore initially discarded revision history and could not remap message-owned attachments. It now preserves all revisions and maps message identities.
4. Deletion initially removed files inside the database transaction without a reversible filesystem step. Files are now renamed to unique staging paths and restored if the database transaction fails.
5. The first navigation policy would have blocked the app's own initial load. It now permits only the exact packaged file URL or an explicitly loopback development URL and denies new windows.
6. The preload `esbuild` step stalled indefinitely. It was replaced with deterministic TypeScript CommonJS compilation; the produced sandbox preload builds and launches successfully.
7. Review found that caught rollback did not cover process death between filesystem and SQLite operations. A single-instance lock now excludes concurrent reconcilers, and startup deterministically restores or removes staged/orphan attachment files according to committed database state.
8. Review found semantic queries could rank a new model generation against stale vectors. Search now requires an exact provider/version/model/model-digest/chunking-digest match and returns no stale generation.
9. Review found the displayed workspace path did not describe the shared database/attachment root and restored workspaces were inaccessible after restart. The app now displays the truthful Waypoint data root and provides a workspace selector.
10. Review found archive lifecycle loss and partial multi-call capture. Archive v2 restores remapped activities/tombstones; initial chat/message and memory/relationship capture are single store transactions.
11. Review found source-linked memory ownership was undefined. Creation now records immutable workspace/source ownership, deletion clears workspace-owned source references and cascades source-owned memory, and the UI makes the choice explicit.
12. Review caught a positional-column migration defect introduced by memory ownership. Every memory insert now names columns explicitly, schema version 3 is recorded, and an old-schema upgrade regression test passes.
13. Renderer containment was tightened with a restrictive CSP, exact sender/frame IPC authorization, denied child windows/navigation, and an unauthenticated HTTP-loopback-only development origin.

## Explicit limitations

- Windows build/package/launch/update/filesystem/process verification remains mandatory on Windows and is platform-contingent by user decision.
- Code signing/notarization and production update delivery are later release gates.
- Semantic search is optional: authored content remains durable and text-searchable when Ollama or the selected model is unavailable. Peer-device embedding service and alternative chunking are future provider implementations, not Phase 1 dependencies.
- No Docker, remote serving, external tenant connection, deployment, or publish action was used.

## Review

Independent adversarial review reproduced and drove repairs for crash reconciliation, truthful storage paths, inaccessible workspaces, partial capture, archive lifecycle/provenance, exact embedding generations, single-instance safety, memory ownership, renderer containment, and legacy schema migration. Final re-review found no unresolved blocker/high-severity finding.

Non-gating residuals retained for hardening: structurally self-consistent archives are not yet size-bounded or fully schema-strict, and Ollama embedding/model-list requests have a very narrow adjacent model-update race. Both fail locally without bypassing workspace boundaries; they are recorded for follow-up rather than silently treated as solved.
