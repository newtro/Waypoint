# Phase 1 local product alpha plan

## Scope

Only the approved Phase 1 roadmap scope is included: guided personal workspace creation; durable documents, chats, messages, memories, relationships, and explicitly supported attachments; traceable text/semantic search; memory graph navigation; first-pass activity timeline; export/restore; and true local cascade deletion.

CLI execution, peer sync, remote embedding workers, calendar, meetings, webhooks, schedules, and team workspaces remain outside Phase 1.

## Security profile

- Workspace-only repository writes.
- SQLite and attachments are owned by the Electron main process.
- Renderer receives narrow validated IPC methods, never filesystem/database handles.
- Ollama access remains optional and loopback-only.
- No Docker, secrets, deployment, or unrelated external services.

## Acceptance criteria

1. Onboarding creates a personal workspace and clearly reports its local data path.
2. Documents, revisions, chats/messages, memories, graph relationships, and supported text/Markdown attachments survive store close/reopen.
3. Text and semantic results include source object/revision provenance.
4. Graph navigation returns typed surviving nodes/edges only.
5. Activity events are structured and content-minimized.
6. Deleting a document/chat/memory transactionally removes owned revisions/messages, attachments, embeddings, FTS entries, touching edges, and dependent queued-work placeholders while writing a content-free tombstone/activity event.
7. Export to a versioned archive and restore into a new workspace round-trip representative data; derived indexes rebuild rather than being trusted from the archive.
8. Interrupted/crash-like transactions do not leave partial authored or deleted state.
9. Electron renderer remains sandboxed and uses validated IPC; the primary onboarding/capture/search/delete flow is inspectable.
10. Tests, lint, type/build, native macOS packaging, and audit pass; independent review has no unresolved blocker/high finding.

## Executor and reviewer

- Executor: primary implementation task.
- Reviewer: fresh independent context receiving implementation and acceptance criteria without builder rationale.
