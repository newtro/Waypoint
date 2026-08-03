# Waypoint decision log

## Settled product decisions

| Decision | Status | Consequence |
|---|---|---|
| Electron + TypeScript + React | Settled | One desktop application stack targets macOS and Windows. |
| Desktop first | Settled | Mobile is a later companion, not an MVP peer. |
| Mac and Windows are peer clients | Settled | Both retain useful local state and can perform authorized work. |
| User-hosted Ubuntu/AWS coordination | Settled direction | Setup, operations, identity, encryption, and recovery must be productized. |
| Signed-in Codex and Claude Code CLIs | Settled | Build versioned CLI adapters; do not assume ordinary LLM APIs. |
| Local embeddings | Settled | Indexing, versioning, hardware compatibility, and deletion are client concerns. |
| Durable chats, documents, and memory graph | Settled | They share a canonical object/lifecycle model. |
| True cascade deletion | Settled | Derived data, sync replicas, queues, and graph edges are included. |
| Personal-first workspaces | Settled | Team/organization administration is outside the MVP. |
| Visible routing and orchestration | Settled | Model, device, agent lineage, status, and permissions are user-facing. |
| Security profiles | Settled | Execution is constrained by named, inspectable capability bundles. |
| Activity timeline | Settled | Meaningful content, AI, sync, device, and security events are visible. |
| Peer-device execution | Settled | Target-device authorization and enforcement are mandatory. |
| Native guided onboarding | Settled | Data location, CLI state, node setup, and permissions are explained in-product. |
| Audio-only recorder, webhooks, calendar | Planned later | Preserve boundaries; exclude full functionality from MVP. |
| Schedules, playbooks, sandboxing, health, backup | Planned | MVP includes only the minimum trust/recovery baseline it needs. |
| User-controlled data boundaries | Settled principle | Storage, sync, encryption, retention, and execution location stay inspectable and controllable. |
| No required Docker dependency | Settled | Build, test, setup, and runtime use native macOS/Windows paths; Docker may only be an optional future sandbox backend. |
| Windows verification is platform-contingent | Settled by user | Windows-only build/package/launch/update/filesystem/process checks are mandatory when work moves to Windows and do not block Mac phases. |

## Working assumptions to validate

1. The first users can operate a guided user-hosted node or accept a supported deployment recipe.
2. Installed CLI behavior is stable enough to support through versioned adapters and compatibility checks.
3. Local embedding quality and latency are acceptable on the oldest supported desktop hardware.
4. Personal-first object ownership can remain simple without blocking future sharing.
5. The activity timeline can be useful without retaining sensitive content redundantly.
6. Peer execution provides meaningful value in the MVP rather than merely architectural completeness.

## Open decisions required before build commitment

### Data and encryption

- Is coordinator-held content end-to-end encrypted so the node cannot decrypt it, or is server-side plaintext processing ever required?
- What metadata is visible to the node?
- Where are workspace keys generated, stored, rotated, recovered, and revoked?
- What is the tombstone retention rule, especially for long-offline peers and backups?
- Are attachments content-addressed, and what deduplication privacy tradeoffs are acceptable?

### Sync and storage

- Which local database and migration strategy fit Electron on both platforms?
- Which conflict model is used for documents, messages, graph edges, and metadata?
- Is server state a relay log, encrypted replica, backup, or some combination?
- What are supported object and workspace size limits for MVP?
- Are embeddings recomputed per device or synced when model versions match?

### CLI integration

- Which minimum/maximum Codex and Claude Code CLI versions are supported initially?
- Which model identity and sub-agent events can be reliably observed from each CLI?
- How does Waypoint distinguish an unavailable feature from an adapter parsing failure?
- Which working-directory, environment, and credential inheritance policies are safe defaults?

### Security and peer execution

- What OS mechanisms enforce profiles on macOS and Windows in MVP?
- Which actions require per-run approval versus durable authorization?
- How are peer requests authenticated, queued, canceled, and protected from replay?
- What resource budgets limit orchestration depth, concurrency, runtime, disk, and network use?

### Product behavior

- What is the MVP document editing format: plain text/Markdown, structured rich text, or both?
- Which attachment types receive previews, extraction, or indexing?
- Are memories exclusively user-curated, automatically proposed, or automatically persisted under policy?
- What graph relationships are user-visible and editable?
- What minimal backup destination and restore experience qualifies for MVP release?

### Distribution and operations

- What OS versions and CPU architectures are supported?
- How are desktop and node updates signed, staged, rolled back, and kept protocol-compatible?
- Is the Ubuntu/AWS node installed through a native package, infrastructure template, or multiple supported non-Docker paths?
- What diagnostics may leave the device, and what is strictly opt-in?

## Recommended decision sequence

1. Define object ownership, deletion, and retention semantics.
2. Choose encryption posture and coordinator trust boundary.
3. Prototype CLI adapters and confirm observable routing/orchestration data.
4. Prototype local storage, embeddings, and sync conflicts together.
5. Define security-profile enforcement and peer execution protocol.
6. Lock the supported platform/version matrix.
7. Finalize onboarding, backup baseline, and release criteria.

## Change-control convention

When a decision changes, record the date, prior choice, new choice, reason, and affected milestones. Do not silently rewrite a settled decision whose consequences have already shaped implementation or user expectations.

## Phase 2 implementation decisions (2026-08-03)

- Default AI execution is read-only, tool-free, local-only, explicitly approved, single-concurrency, and bounded to two minutes. Broader named profiles require a later deliberate product decision.
- Prompts travel over child stdin, never process argv. CLI OAuth remains owned by the signed-in CLI; only `HOME`, `USER`, `PATH`, `LANG`, and `NO_COLOR` are inherited, and Waypoint does not inspect or persist CLI credentials. `USER` is required for Claude Code to resolve its macOS sign-in state.
- AI subprocesses run from a dedicated per-workspace execution directory beneath the app data root, never from the shared database/attachment directory. This preserves workspace isolation while avoiding a Docker dependency.
- Run provenance stores a prompt digest rather than duplicating prompt content. The durable user message remains the content owner, and deleting its chat cascades run/events.
- Phase 2 child lineage is limited to one child depth. Recursive autonomous delegation and peer execution remain outside this phase.
- The renderer starts a run and receives its ID immediately; terminal persistence continues in the main process so cancellation and status polling remain available.

## Phase 3 local-foundation decisions (2026-08-03)

- `libsodium-wrappers-sumo` is pinned at `0.8.4` behind a small main-process-only facade. The official portable JS/WASM build avoids native-addon and Docker requirements. Only Ed25519 signatures, X25519 sealed key wrapping, XChaCha20-Poly1305 authenticated encryption, Argon2id recovery derivation, secure randomness, and constant-time comparison are allowed. This choice inherits reviewed primitives but is not a claim that the Waypoint protocol itself has received a professional audit.
- The coordination node remains an opaque durable relay. Visible metadata is limited to protocol version, opaque workspace/device identifiers, key epoch, immutable change ID, per-device sequence, envelope type/size, delivery cursor/timestamps, public enrollment keys, and expiring presence. Workspace names, object identifiers, bodies, filenames, hashes, prompts, CLI credentials, local paths, raw execution output, and workspace keys stay encrypted or local.
- Device enrollment is explicit, workspace-scoped, expiring, one-use, and approved by an active owner device. Revocation advances membership epoch and stops delivery and execution; it cannot erase data already decrypted on a lost device. Production workspace-key rotation/re-wrapping orchestration remains part of the real-node gate and is not claimed by the local registry foundation.
- Concurrent document and memory bodies preserve recoverable variants. Append-only messages converge by stable identity. Metadata uses deterministic clock/device ordering only where it cannot discard authored content. Deletion dominates every stale or concurrent update to the same identity; restore creates a new identity.
- Tombstones remain at least 90 days and until every active peer acknowledges them. A long-offline peer must be revoked before purge and must re-enroll from a fresh snapshot.
- Attachment transfer uses bounded independently authenticated chunks so interruption resumes without trusting partial files. Embeddings remain device-local and are recomputed rather than synchronized.
- Every peer run requires explicit target approval in the MVP. The target chooses and enforces its own `peerEligible` security profile; a requester cannot transmit or widen roots, tools, secrets, network, duration, or concurrency.
- The current deliverable is a Mac-local protocol and relay simulation. Real Ubuntu/AWS, TLS/domain/public networking, native Windows validation, signing/update policy, production recovery, and professional protocol audit remain mandatory deferred gates, not implied successes.

## Phase 4 current-Mac hardening decisions (2026-08-03)

- Waypoint has no product telemetry or automatic crash upload in the MVP. Guided diagnostics run locally; a user may explicitly save a content-minimized report whose paths, content, prompts, credentials, keys, and raw errors are excluded.
- The MVP recovery baseline is a bounded, corruption-checked plaintext logical backup at a user-selected location. SHA-256 detects accidental corruption, not malicious replacement or authenticity. External backups have a retention lifecycle separate from live deletion and must be protected and deleted by the user.
- Restore always creates a new workspace and object identities. Authored content, supported attachments, content-minimized lifecycle history, execution provenance, and profile definitions may be restored; embeddings/full-text indexes rebuild, and device keys, credentials, transport/session state, and peer enrollment are excluded.
- Schema 5 begins an ordered migration registry from the known schema-4 baseline. A known old database receives a retained pre-migration SQLite snapshot; migrations are transactional and stamp only after success. A newer unknown schema fails closed, and Waypoint never automatically downgrades.
- Current-Mac backup replacement uses a durable temporary file, verified deterministic prior copy, one atomic rename over the destination, and directory synchronization. Windows replacement semantics remain a mandatory platform-contingent test.
- Direct packages are pinned exactly with Node `22.16.x`, npm `10.9.x`, and lockfile reproducibility. High-severity audit, complete declared-license inventory, and a production CycloneDX SBOM are release evidence.
- The version-2 performance fixture and absolute budgets are current-Mac regression controls, not claims for Windows or the oldest supported hardware. It measures startup/reopen, search, index writes, attachment ingestion, graph, diagnostics, and database growth.
- Docker remains unnecessary. Packaged clients do not require Node; source development and the future native Ubuntu service use pinned native Node/npm paths.
