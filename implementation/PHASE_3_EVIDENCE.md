# Phase 3 local-foundation evidence

## Implemented boundary

- `electron/core/sync/crypto.ts` provides the trusted-process libsodium facade for Ed25519 identities/signatures, X25519 sealed workspace-key wrapping, XChaCha20-Poly1305 signed envelopes with authenticated key epoch/sequence, and attachment-chunk AEAD.
- `electron/core/sync/device-registry.ts` implements signed, expiring, one-use enrollment, terminal identity revocation, membership epochs, and expiring presence without persisting private keys.
- `node/relay/service.ts` is an in-memory opaque relay domain service only. It has no listener. It enforces injected active-device/key-epoch authority, monotonic sender sequence, bounded ciphertext, expiry, collision-safe replay, recipient authority, scoped acknowledgement, and defensive copies.
- `electron/core/sync/conflict.ts`, `schema.ts`, and `sync-engine.ts` implement deterministic causal convergence, recoverable authored variants, deletion dominance, replay/collision protection, and fail-closed schema negotiation.
- `electron/core/sync/sync-store.ts` provides durable SQLite device, mutation, encrypted outbox, inbox, conflict, tombstone acknowledgement, attachment-progress, and peer-request state. Plaintext pending mutations are atomically replaced by encrypted envelopes, delete removes stale pending upserts, conflict resolution must descend causally from every variant, and purge requires retention plus every active peer acknowledgement.
- `electron/core/sync/attachment-transfer.ts` provides independently authenticated, out-of-order resumable chunks, per-chunk/total bounds, optional final digest verification, and no canonical result before completion.
- `electron/core/sync/peer-execution.ts` denies unknown/revoked sources, wrong targets, invalid lifetimes, bad authentication, replay, disallowed tools/roots, unavailable local profiles, and rejected local approval. The target-local profile remains authoritative.

## Verification

| Check | Status | Evidence |
|---|---|---|
| Focused sync/crypto/relay tests | Pass | 8 Phase 3 files, 28 tests after adversarial repairs. |
| Full Vitest suite | Pass | 19 files, 96 tests. Node SQLite prints its expected experimental API warning; no test fails. |
| Lint and TypeScript/build | Pass | ESLint and the composite Electron/preload/Vite production build pass. `node/relay` is explicitly part of the strict Node TypeScript project. |
| Dependency audit/license | Pass | `npm audit --audit-level=high` reports zero vulnerabilities. Exact `libsodium-wrappers-sumo@0.8.4` and `libsodium-sumo@0.8.4` resolve from the lockfile; both declare ISC. Registry integrity values were checked and licenses are present in the packaged archive. |
| macOS directory package / crypto load | Pass | Electron Builder produced the unsigned arm64 directory package. Archive inspection found both exact libsodium distributions and the compiled crypto module; an extracted-package signed-encrypt/decrypt smoke passed. Signing remains Phase 4. |
| Independent adversarial review | Pass | The first review found five high-severity policy/restart/retention/relay issues. After repair, focused independent re-review found no unresolved blocker or high-severity finding; its 4-file/17-test verification passed. |

## Adversarial repairs before independent review

1. The first opaque relay accepted bytes without proving sender membership. It now requires injected active-device/key-epoch authority, monotonic sequence, and active recipient authority for pull/ack.
2. Initial envelopes did not authenticate key epoch and sequence. Both fields are now bounded, signed, and included in AEAD associated data.
3. The attachment tests initially used a permissive fake cipher, so they did not demonstrate metadata authentication. The production libsodium chunk adapter now has wrong-AAD and ciphertext-tamper tests, and the receiver enforces chunk-count/total-byte bounds plus optional final SHA-256.
4. Peer authorization distinguished only revoked/not-revoked, which could admit an unknown identity. The target now requires an actively enrolled source.
5. Durable conflict resolution initially compared a resolver only with the current head. It now clears variants only when the resolver causally descends from every stored authored variant.
6. Independent review found applicant-only enrollment authorization and process-local replay sets. Enrollment now requires an active owner's signed approval at the current membership epoch, and enrollment/peer nonces use an injected durable SQLite-backed ledger with restart coverage.
7. Independent review found peer approval could be skipped by profile configuration. Every peer request now requires target approval regardless of that field.
8. Independent review found caller-bypassable tombstone retention. The minimum is now a fixed 90 days with 89/91-day boundary coverage.
9. Independent review found non-finite relay expiry could create immortal envelopes and that relay claims exceeded enforcement. Relay validation now rejects malformed dates, requires injected signature verification, and enforces global-count and per-workspace byte quotas. Documentation now explicitly defers rotation orchestration and fork/checkpoint detection.

## Gate result

The Mac-local Phase 3 foundation is clean under the scoped gate: verification passes and the independent reviewer reports no unresolved blocker/high. The full roadmap private-beta gate remains open for the deferred real Ubuntu/AWS, Windows, TLS/public-network, key-rotation/recovery orchestration, signing/update, and professional protocol-review evidence below.

## Required deferred evidence

- The foundation modules are not yet wired into ordinary `WorkspaceStore` mutations or a renderer device/conflict UI. That product integration requires the real-node transport boundary and must preserve same-transaction mutation enqueueing; this phase does not claim end-to-end user-visible sync.
- Production protected private-key persistence, workspace-key rotation/re-wrapping, recovery-artifact UX, encrypted snapshots, and fork/checkpoint detection remain unimplemented. No private key is persisted by the current foundation.
- Real user-hosted Ubuntu/AWS host provisioning and public TLS/network failure testing.
- Native Windows client, protected-key-store, filesystem/process, package, launch, and update matrix.
- Release signing/notarization and production update compatibility.
- Professional review of the complete enrollment, recovery, revocation, and encrypted-sync protocol.

No public deployment, external account connection, credential use, or third-party data transfer occurred in this phase.
