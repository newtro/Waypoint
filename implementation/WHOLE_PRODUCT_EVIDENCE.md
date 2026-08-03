# Whole-product gate evidence

## Integrated outcome

- Durable workspace content, full-text/local semantic retrieval, graph relationships, activity, true local cascade deletion, bounded archive restore, and crash-safe backup/recovery share the same SQLite lifecycle.
- Signed-in Codex and Claude Code runs visibly stream normalized events and expose model, executable/version, device, security profile, status, failure guidance, and bounded parent/child lineage.
- Ordinary authored mutations and deletions enqueue durable sync journal changes in the same transaction. The UI exposes only sanitized local sync status and an honest Docker-free setup handoff; no keys, enrollment, node connection, or external data transfer occurs automatically.
- Guided readiness checks local storage and both CLIs independently. Existing documents autosave through a serialized, retryable controller; navigation and own-document deletion flush pending drafts, while unrelated deletion keeps the editor mounted.
- Health diagnostics, redacted export, migration snapshots, dependency/SBOM checks, accessibility hardening, and performance budgets are available locally.

## Final verification

- Vitest: 29 files, 142 tests.
- ESLint and composite TypeScript/preload/Vite production build pass.
- Authorized bounded Codex and Claude Code completion, failure, and cancellation checks pass without workspace writes.
- `npm audit --audit-level=high` reports zero vulnerabilities.
- Seeded performance v2 budgets pass.
- Electron Builder produces the native macOS arm64 directory package; native launch passed with an isolated user-data directory.
- Independent whole-product review required repair of local sync integration, AI visibility/lineage/failure UX, readiness onboarding, CLI compatibility policy, autosave, and two navigation/delete data-loss paths. Final re-review has no unresolved blocker/high.

## Mandatory deferred evidence

- Real user-hosted Ubuntu/AWS TLS transport, protected device-key setup, enrollment/revocation UX, encrypted outbox delivery/pull/ack, inbound canonical materialization, and a real two-peer recovery/conflict matrix require separate external setup authority.
- Native Windows build/package/launch/update/filesystem/process/accessibility/destructive verification remains platform-contingent.
- Developer ID signing/notarization, application release identity/icon, publication/update delivery, and professional protocol review remain release gates.

These deferrals mean this is a complete current-Mac local test build with safe integration foundations, not a claim that the external two-peer private-beta or signed cross-platform release gate has passed.
