# Phase 3 — Mac-local private-beta foundation

## Scope

This phase implements and verifies the private multi-peer protocol foundation without connecting to a real Ubuntu/AWS host, opening a public listener, using external credentials, or claiming Windows validation.

In scope:

- a pinned, portable, high-level libsodium facade for signed and authenticated encrypted envelopes;
- explicit device identity, one-use enrollment, revocation, key epochs, and expiring presence;
- an opaque local relay simulation that validates delivery authority but cannot decrypt workspace content;
- durable mutation/outbox/inbox state with replay protection;
- deterministic offline convergence, authored-content conflict preservation, and deletion dominance;
- schema/protocol negotiation that fails closed;
- bounded, integrity-checked, independently resumable encrypted attachment chunks;
- signed peer-execution requests that can run only after target approval under a target-local eligible security profile.

Out of scope and still required for the full Phase 3 private-beta gate:

- real Ubuntu/AWS provisioning, TLS certificates, DNS, firewall and public-network operation;
- native Windows build/package/runtime, DPAPI/key storage, filesystem, process, and update validation;
- release signing, notarization, and cross-platform update policy;
- production account recovery and a professional cryptographic protocol audit;
- public deployment or ingestion of third-party account data.

Docker is not required or used.

## Security profile

- Cryptography runs only in trusted main/node contexts and is never exposed to the renderer.
- Workspace data keys and device private keys are client-side material. The relay receives public enrollment material, opaque identifiers, bounded ciphertext, sequence/delivery metadata, and expiring presence only.
- No plaintext fallback is permitted when protected local key storage is unavailable.
- Peer execution is denied by default. A remote requester cannot specify roots, tools, secrets, network grants, duration, or concurrency; the target loads and enforces its own profile.
- Unknown versions, invalid signatures, expired/replayed requests, revoked devices, malformed ciphertext, oversize chunks, and integrity failures fail closed.

## Acceptance criteria

1. Crypto round trips succeed and tampering, wrong keys, wrong signatures, replay, and key-epoch mismatch fail.
2. Enrollment is explicit, scoped, expiring and one use; revoked devices lose relay, presence, and peer-execution authority.
3. Relay inspection cannot find representative document, prompt, filename, or attachment plaintext.
4. Reordered, duplicate and concurrent changes deterministically converge; document/memory variants remain recoverable.
5. Tombstones dominate stale updates and cannot purge before 90 days plus acknowledgement from every active peer.
6. Interrupted attachment transfer resumes by missing chunk; corrupt or incomplete material never becomes canonical.
7. Compatible schema ranges negotiate; incompatible versions stop before application with an actionable result.
8. Peer execution requires explicit target approval and an eligible target-local profile; replay and privilege injection fail.
9. Tests, lint, build, dependency audit, macOS directory packaging, and packaged crypto loading pass.

## Gate interpretation

Passing this plan means the Mac-local foundation is clean under adversarial review. It does not close the roadmap's real Mac/Windows/Ubuntu private-beta gate. Those platform and external-environment checks remain explicit, mandatory deferred evidence.
