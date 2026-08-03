# Waypoint initial threat model

## Scope and assets

Phase 0 covers desktop workspace data, attachments, embeddings, graph links, activity metadata, encryption and device keys, CLI execution privileges, sync envelopes, tombstones, and recovery artifacts. Provider-side behavior and the user's operating-system account are outside Waypoint's direct control but remain dependencies.

## Trust boundaries and actors

1. Renderer ↔ privileged Electron main process.
2. Main process ↔ local filesystem/database and OS credential store.
3. Waypoint ↔ installed Codex/Claude Code child processes.
4. Desktop peer ↔ untrusted network ↔ user-hosted coordinator.
5. Coordinator ↔ another enrolled peer.
6. User ↔ offline recovery/export material.

Adversaries include a malicious document or prompt, compromised renderer, malicious/buggy CLI output, network attacker, compromised coordinator, stolen/revoked device, stale offline peer, local unprivileged process, and an operator with access to coordinator storage.

## Threats, mitigations, and validation

| Threat | Initial mitigation | Required validation / residual risk |
|---|---|---|
| Renderer gains filesystem/process authority | Sandbox, context isolation, Node disabled, narrow typed IPC, path authorization in main | IPC fuzzing and Electron security review in Phases 1–2; Electron compromise remains residual risk. |
| Prompt/document or CLI output authorizes privileged action | Treat content/output as data; local security profile and user approval are the only authority | Adversarial prompt/output tests in Phase 2. CLI itself still runs with granted OS rights. |
| PATH shadowing executes attacker binary | Resolve once, validate exact path, invoke without shell; display executable/version | Platform-native resolution and shadowing tests; signed binary verification is an open hardening option. |
| Coordinator reads workspace content | Client-side authenticated encryption; wrapped workspace keys per device; no provider credentials on node | Select audited protocol/library before Phase 3; node still sees documented delivery metadata. |
| Network replay/reordering | Authenticated envelopes, immutable change IDs, per-device sequence/causal metadata, idempotent application | Multi-peer replay/reorder/property tests in Phase 3. |
| Revoked/stale peer resumes sync | Stop delivery/key wrapping; tombstones dominate; revoke peers before tombstone purge; fresh snapshot for re-enrollment | A lost device retains previously decrypted local data; OS full-disk encryption and remote wipe are user controls. |
| Deletion leaves derived or replicated data | Transactional local cascade, source-linked indexes, encrypted tombstone propagation, ack-based purge | Local cascade tests Phase 1; distributed anti-resurrection and backup-retention tests Phase 3/4. Recovery exports follow separately disclosed retention. |
| Malicious attachment escapes workspace | Content-type distrust, no automatic execution, bounded parsing in isolated workers/processes | Parser-specific fuzzing and size bombs remain required when supported types are selected. |
| Key loss locks out user | Explicit offline recovery artifact, guided verification, no silent server key | Recovery artifact theft enables access; protect with strong user secret and test rotation/recovery before Phase 3. |
| Activity timeline leaks deleted content | Structured content-minimized events; no duplicated bodies/raw output by default | Schema tests ensure deletion events contain identifiers/category only. Metadata leakage remains disclosed. |
| Peer execution exceeds target policy | Target re-authenticates request and enforces its own profile, budgets, roots, and approvals | Cross-platform process containment tests in Phase 3; OS sandbox limits vary. Docker cannot be required. |
| Resource exhaustion from indexing/sync/agents | Size, time, output, concurrency and disk budgets; resumable jobs | Limits require workload measurement in Phases 1–3. |
| Supply-chain compromise | Lockfile, dependency review, minimal native modules, signed release artifacts | Phase 4 audit/signing; npm compromise remains a residual risk. |

## Security decisions resulting from this model

- The coordinator cannot require plaintext workspace content.
- Custom cryptography is prohibited; protocol and library selection is a Phase 3 prerequisite.
- Deletion safety requires both tombstone dominance and a peer lifecycle rule.
- Renderer convenience never overrides main-process authorization.
- Docker is not a security prerequisite; native platform controls must provide the baseline.
- Recovery, diagnostics, and activity data require their own explicit retention disclosures.

## Open high-risk validations

- Native Windows renderer/process/filesystem behavior and security-profile enforcement.
- Real signed-in CLI streaming, cancellation, authentication failure, and hostile output behavior.
- Audited end-to-end encryption protocol selection, key recovery, replay resistance, and metadata review.
- Representative local embedding runtime license, package size, memory, latency, and retrieval quality.
- Full Mac/Windows/coordinator convergence, revocation, and deletion tests.
