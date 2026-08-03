# Durable chat attachment backend

## Implemented boundary

- Chat-, message-, document-, and memory-owned attachments share the workspace-scoped content store and immutable owner/source metadata.
- Explicit extension/MIME pairs support PNG, JPEG, WebP, GIF, PDF, DOCX, UTF-8 text, and Markdown. Binary formats remain opaque: Waypoint checks a minimal file signature for mismatch detection but does not render, execute, unzip, or parse them.
- Limits are 25 MiB per file, 20 attachments per owner, and 500 per workspace. Filenames are basename-normalized and capped at 240 characters.
- Validated bytes are written once with exclusive creation and owner-only `0600` mode inside a `0700` attachment directory. The directory is tightened on every reopen. SHA-256 is checked before export and provider preparation. Startup reconciliation and transactional metadata/journal rollback remove incomplete copies.
- Metadata lists workspace, immutable owner ID/kind, filename, exact media type, byte length, digest, and creation time. Cross-workspace lookups fail.
- Export embeds integrity-checked bytes. Restore revalidates archive/global/owner limits, allowed pair, signature, UTF-8, digest, remaps chat/message owners and attachment identity, and writes owner-only files. Sync/device state remains outside the archive.
- Deleting a message or chat stages and removes owned files, metadata, derived indexes/queues/relationships, source-owned memory descendants, and pending sync heads/upserts. Workspace-owned memories survive with their source detached. Deletion writes content-minimized tombstones and sync mutations.
- Provider preparation returns inline verified text only when the adapter declares inline-text support, an integrity-checked absolute path only when it declares that exact media type and file-path support, or an explicit unsupported result. It never claims a PDF, DOCX, or image was understood.

## Verification

- Focused attachment/store suite: 2 files, 25 tests. Full repository: 31 files, 157 tests; lint, production build, dependency audit, and diff check pass.
- Covered: every supported family, MIME/extension/signature mismatch, invalid/oversize input, owner count, cross-workspace isolation, forced journal rollback and copied-file cleanup, reopen, message/chat cascades, sync metadata/head purge, export/restore owner remapping, provider capability outcomes, and digest corruption.
- Lint and production build pass.
- Independent review initially found a high-severity local metadata exposure because the attachment directory inherited the default umask even though files were `0600`. Creation and reopen now enforce `0700`, with a regression that deliberately loosens and verifies re-tightening. Final independent re-review passed 8/8 focused tests and reports no unresolved blocker/high.

## IPC/UI hooks still required

These hooks were deliberately not added while another executor owns the renderer/IPC surface:

1. A main-process file-picker handler that derives the trusted source path and MIME candidate, then calls `addAttachment`; the renderer must never submit an arbitrary filesystem path as authority.
2. Sanitized `listAttachments(workspaceId, ownerId)` metadata for the selected chat/message. Do not expose stored relative or absolute paths.
3. Explicit remove-message/remove-chat actions using existing confirmation and `deleteMessage`/`deleteObject`; an optional single-attachment removal backend does not yet exist.
4. AI-run preparation in the trusted execution controller using `prepareAttachmentForProvider`; only that controller may receive returned paths/text, and it must still respect the target security profile and adapter capability/version.
5. UI status that distinguishes attached/stored from delivered-to-provider and provider-supported from unsupported. Never label a binary as read or understood solely because a path was supplied.
