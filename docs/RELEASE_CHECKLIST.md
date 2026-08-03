# Release checklist

This checklist distinguishes a Mac-local development gate from a publishable cross-platform release. A checked local item must not be used to imply completion of a deferred external or platform gate.

## Source and dependency integrity

- [ ] Clean working tree and intentional reviewed commit.
- [ ] `npm install` resolves the committed lockfile without unexpected changes.
- [ ] `npm test`, `npm run lint`, and `npm run build` pass.
- [ ] `npm audit --audit-level=high` has no unresolved high-severity finding.
- [ ] New runtime dependencies have documented source, license, version pinning rationale, package contents, and trusted-process boundary.
- [ ] Docker is not required for build, test, package, setup, or runtime.

## Product and destructive behavior

- [ ] Onboarding reaches a captured, searchable local item.
- [ ] Restart and unexpected-termination tests preserve representative documents and chats.
- [ ] Text and semantic search link results to traceable sources.
- [ ] Missing/expired Codex and Claude Code paths fail terminally without workspace corruption.
- [ ] Cancellation, timeout, retry, shutdown, and output-limit paths preserve coherent chat/run state.
- [ ] Workspace boundaries and renderer/main-process authorization resist cross-workspace access.
- [ ] Document, chat, and memory deletion remove owned content, attachments, indexes, graph edges, queued work, and executions while leaving only content-minimized evidence.
- [ ] Representative export/restore and failed-restore rollback are demonstrated.
- [ ] Plaintext export disclosure is visible and documentation is current.
- [ ] Low-disk, corrupt archive/attachment, migration failure, and rollback paths are exercised.

## Privacy, accessibility, and performance

- [ ] No telemetry, analytics, crash, or diagnostic upload occurs without a separately reviewed opt-in design.
- [ ] No work/personal third-party account, app registration, or credential is connected during local release verification.
- [ ] Ollama remains optional and loopback-only; embeddings remain local.
- [ ] Keyboard navigation, focus visibility/order, labels, reduced motion, contrast, zoom, and practical desktop widths are verified.
- [ ] Startup, search, indexing, large-workspace, attachment, and database growth budgets have measured evidence.

## Native packages

- [ ] macOS package builds and launches on every supported macOS/architecture target.
- [ ] macOS signing, hardened runtime, entitlements, and notarization pass. **Deferred for the current local build.**
- [ ] Windows build, package, launch, update, filesystem, process cancellation, and protected-storage matrix passes on native Windows. **Platform-contingent and deferred.**
- [ ] Installation, upgrade, schema migration, rollback, downgrade refusal, and uninstall/data-retention behavior are documented and tested per platform.

## Coordinator and multi-peer gate

- [ ] Native non-Docker Ubuntu/AWS installation and least-privilege service operation are verified.
- [ ] Real TLS/domain/firewall/public-network behavior and node upgrades/rollback are verified.
- [ ] Mac/Windows enrollment, offline convergence, conflict recovery, attachment resume, revocation, and stale-delete anti-resurrection pass through the real node.
- [ ] Key persistence, rotation/re-wrapping, recovery, encrypted coordinator backup, and fork/checkpoint behavior pass destructive drills.
- [ ] The complete protocol receives appropriate independent/professional review.

All coordinator/account/TLS and real peer items above are deferred until the user explicitly authorizes the required infrastructure, credentials, and device access.

## Publication gate

- [ ] Supported OS/version and protocol compatibility windows are fixed.
- [ ] Release artifacts, checksums, provenance, and release notes are generated.
- [ ] Publishing destination and staged update/rollback channel are explicitly authorized and verified.
- [ ] User documentation and data-boundary disclosures match the shipped build.
- [ ] Final whole-product adversarial review has no unresolved blocker or high-severity finding.

Public publishing, deployment, automatic updates, signing/notarization, and external account integration are not authorized by the current local build workflow and remain deferred.
