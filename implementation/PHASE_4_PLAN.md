# Phase 4 — current-Mac hardening release candidate

## Scope

This phase makes the local core supportable and recoverable without deploying, publishing, connecting external accounts, or claiming unavailable platforms. It adds guided content-minimized diagnostics, explicit privacy boundaries, accessibility/responsive hardening, bounded backup and recovery, ordered schema migration, reproducible dependency evidence, destructive recovery tests, a seeded performance baseline, and native Docker-free setup documentation.

The security profile remains local-first: the renderer receives narrow IPC only; diagnostics do not upload; CLI checks invoke only `--version`; Ollama health uses loopback only; backups are explicit user-selected plaintext files; no node, account, TLS, or third-party data is connected.

## Acceptance criteria

1. Guided checks report database/schema/foreign-key, disk, attachment, text-index, optional embedding, CLI, and local sync state with stable status/remediation and no content or raw paths in exported reports.
2. Backup creation is bounded, corruption-checked, crash-recoverable, permission-restricted, directory-synced, and atomically replaces the destination on the current Mac while retaining a deterministic verified prior copy. Restore uses fresh object/workspace identity and excludes derived indexes, device keys, credentials, and transport state.
3. Unknown newer schemas fail closed. Known older stores receive a bounded pre-migration snapshot; ordered migrations stamp only after a successful transaction and are restart-idempotent. No automatic downgrade occurs.
4. Destructive tests demonstrate cascade deletion, separate backup retention, fresh-identity recovery, text-index repair, global attachment accounting, foreign-key damage detection, and process-death recovery at each backup replacement boundary.
5. Keyboard focus is visible, state is not color-only, reduced motion is honored, compact/zoomed layouts stack without fixed-width overflow, and diagnostics expose meaningful labels/live status.
6. A versioned seeded current-Mac benchmark covers startup/reopen, lexical search, embedding-index writes, attachment ingestion, graph, diagnostics, database size/growth, and explicit budgets.
7. Direct dependencies and build tools are exactly pinned; Node/npm source requirements are pinned; audit, license inventory, production SBOM, tests, lint, build, current-Mac packaging, and bounded packaged launch pass.
8. Mac, Windows, Ubuntu coordinator, recovery, troubleshooting, data-boundary, and release documents are truthful and Docker-free.
9. Independent adversarial re-review has no unresolved blocker or high-severity finding.

## Deferred release gates

- Apple Developer ID signing/notarization and any publication/update channel require credentials and separate release authority.
- Windows-native build, packaging, launch, update, filesystem, process, accessibility, destructive, and signing checks require a Windows machine and certificate.
- A real Ubuntu/AWS node, TLS/domain/firewall, external account, second peer, and real-network recovery matrix require user provisioning and credentials. The present relay remains a listener-free local foundation.
- Therefore this phase may pass its current-Mac hardening gate but cannot be described as a signed, published, cross-platform MVP release.

