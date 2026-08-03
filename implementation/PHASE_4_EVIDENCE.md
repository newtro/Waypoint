# Phase 4 current-Mac hardening evidence

## Implemented boundary

- A guided Health panel runs content-minimized local checks for actual SQLite schema/integrity/foreign keys, disk capacity/write access, workspace-scoped missing/damaged attachments with global orphan accounting, canonical text-index parity, optional loopback Ollama, side-effect-free CLI versions, and local sync configuration. Saved reports are explicitly user initiated and redact content, paths, credentials, and raw errors; Waypoint has no telemetry or crash uploader.
- Versioned archives are strictly bounded before restore. Backup creation writes and verifies a permission-restricted temporary file, retains a deterministic verified `.previous` copy, uses one atomic destination rename on the current Mac, synchronizes the directory, and recovers interrupted boundaries. Restore creates fresh identities, rebuilds derived indexes, and excludes device keys, credentials, peer enrollment, and transport state.
- Schema 5 introduces the ordered migration registry. A known older database receives a bounded SQLite snapshot and manifest; migrations transact and stamp only on success, restart idempotently, and reject newer unknown schemas without downgrade.
- Exact dependencies, Node, and npm are pinned. Native Docker-free setup, data-boundary, troubleshooting, recovery, and deferred-release documentation lives in `docs/`.
- Keyboard focus, non-color health labels, reduced motion, responsive diagnostic cards, and compact search/chat stacking preserve the cartographic UI at ordinary, maximized, and zoom-reduced CSS widths.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Full tests | Pass | Vitest: 24 files, 117 tests. Coverage includes three replacement process-death boundaries plus first-ever-backup death/recovery, deterministic prior recovery, unrelated sibling preservation, corrupt/oversize/future archives, migration rollback/newer-schema refusal, two-workspace attachment accounting, actual schema/foreign-key damage, FTS repair, cascade deletion, and all Phase 0–3 suites. |
| Lint / type / production build | Pass | ESLint and composite TypeScript/preload/Vite build passed. Renderer bundle: 207.99 kB (64.54 kB gzip); CSS: 8.20 kB (2.63 kB gzip). |
| Dependencies | Pass | `npm audit --audit-level=high`: zero vulnerabilities. Inventory: 499 packages, zero undeclared licenses. `npm run report:sbom` generated a production-only CycloneDX 1.5 SBOM. Direct package versions and Node/npm toolchain are exact. |
| Seeded performance v2 | Pass | Apple Silicon macOS, Node 22.16.0: 1,000 docs, 2,000 messages, 500 memories, 1,000 edges, 250 index writes, 100 attachment copies. Startup 3.49 ms; reopen 0.70 ms; search p95 0.069 ms; index p95 0.058 ms; attachment p95 0.172 ms; graph 7.84 ms; diagnostics 8.63 ms; database 3,710,976 bytes / 806.7 bytes per canonical object. Every explicit budget passed. These are regression fixtures, not broad hardware claims. |
| Native macOS package | Pass | Electron Builder produced `release/mac-arm64/Waypoint.app`. The package is unsigned and uses the default icon; a valid Developer ID identity is unavailable by design of this local gate. |
| Packaged launch | Pass | The rebuilt arm64 package launched as a second native instance with an isolated temporary user-data directory, preserving the user's already-running Waypoint instance and data. Both native processes remained live. |

## Adversarial review and repair

The first independent Phase 4 review found four high-severity gaps:

1. Backup replacement moved away the only destination before the new rename and did not synchronize its directory. Replacement now keeps a deterministic durable prior copy, performs one atomic destination rename on current macOS, synchronizes the directory, and has subprocess exit/recovery coverage at every boundary.
2. Workspace diagnostics compared the global attachment directory to only one workspace's rows. Missing/digest checks remain workspace-scoped while orphan detection uses every workspace reference; a two-workspace regression passes.
3. Diagnostics returned the compiled schema constant and omitted `foreign_key_check`. They now report the database's actual schema version and block on any foreign-key violation, with injected-damage coverage.
4. The first performance fixture omitted startup/reopen, index writes, attachment ingestion, and database growth. Version 2 adds each path and explicit absolute budgets.

Focused repair verification and the full suite pass. Re-review found one remaining high: recovery was called only before a later backup write, not from verify/restore. The public `readBackup` entrypoint used by both product paths now performs recovery first, and subprocess tests exercise that entrypoint directly. Final root review then found that first-ever backup recovery deleted its only durable partial and could remove arbitrary similarly named siblings. Recovery now promotes a uniquely valid UUID-v4 Waypoint partial when no valid destination/prior exists, deletes only validated artifacts, preserves ambiguous/invalid/unrelated files, and has first-write subprocess coverage. The final independent verdict is clean with no unresolved blocker/high.

## Required deferred gates

- Apple Developer ID signing/notarization, application icon/release metadata, and publication/update delivery require release credentials and explicit publication authority.
- Windows-native package/launch/update/filesystem/process/accessibility/destructive testing and Windows signing require a Windows host/certificate.
- Real Ubuntu/AWS provisioning, TLS/domain/firewall, public transport, second-peer recovery, external accounts, and professional protocol review remain unperformed. The relay is still a listener-free local foundation.
- Backups are plaintext and corruption-checked, not encrypted or authenticated; comprehensive encrypted backup administration remains post-MVP.

No deployment, publication, external account connection, credential use, or third-party data ingestion occurred.
