# R1 desktop sync integration evidence

## Product outcome

- The Electron main process now owns a pinned, signed relay client and OS-protected workspace/device secrets. Renderer IPC exposes only sanitized setup, enrollment, device, rotation, and aggregate sync state.
- Enrollment is signed, expiring, one-use, owner-approved, and completed with fresh device proof. Device listing, terminal revocation, resumable per-device key wrapping, and post-cutover key claims are durable.
- Canonical chats/messages, documents/revisions, memories, relationships, deletes, and attachments converge through the local SQLite journal. Deletes include owned-child tombstones and continue to dominate stale offline updates.
- Attachments use independently authenticated 4 MiB chunks under the existing 25 MiB limit. Missing indices persist locally; the sender retains bounded transfer metadata and selectively resends after interruption.
- Re-enrollment requests an owner-authorized, requester-targeted replacement snapshot. All snapshot items and the destructive manifest stage atomically; the manifest is sent last and is accepted only for an outstanding local request from the active owner.
- Rotation retains one prior key for draining already-accepted envelopes. The relay refuses another rotation until current-minus-one messages have been acknowledged, preventing key eviction while data remains queued.

## Automated matrix

- Isolated same-Mac peer stores cover canonical object materialization, concurrent conflict convergence, offline delete dominance, cascade deletion, outage/recovery, authoritative stale-object removal, three-peer response isolation, previous-epoch drain, malicious peer snapshot rejection, and interrupted multi-chunk selective resume.
- The matrix is automation over isolated identities/process boundaries on one physical Mac. It does not claim two-physical-Mac, Windows, cross-sleep, or heterogeneous-network validation.

## Build-to-Complete review

- The independent integrated review iterated over authority, workspace isolation, snapshot authorization/atomicity, epoch rotation, deletion, attachment bounds/resumption, replay, and resource limits.
- Material findings were repaired rather than waived, including cross-workspace identity substitution, cascade-child resurrection, additive/broadcast snapshots, unauthorized peer pruning, snapshot partial staging, ambiguous request enqueue, prior-epoch loss, and non-resumable attachment gaps.
- Terminal independent verdict: blocker 0, high 0, medium 1, low 0. The bounded medium is that a continuously unavailable relay can fill the 100 retained snapshot-request authorizations in about eight minutes and pause new requests until the oldest 24-hour expiry; durable same-request outbox retry remains a follow-up.

## Verification and remaining native gates

- Terminal local gate: 47 suites / 221 tests, TypeScript/Vite build, ESLint, zero production dependency vulnerabilities, macOS arm64 directory package, packaged import closure, bounded native launch, and diff check pass. The local package remains unsigned as expected.
- Hosted relay update: created `/opt/waypoint-relay/releases/r1-desktop-sync-20260803`, atomically switched `current`, and restarted only `waypoint-relay.service`. A pre-change encrypted backup completed; SQLite `quick_check` passed before and after restart; all six authority tables are installed; the queue and production registry remain empty; loopback/public TLS return the expected authenticated `401`; TLS verification succeeds. Caddy and PostgreSQL remained active and unchanged.
- Two physical Macs remain a required product validation gate when a second Mac is available. Windows build/package/launch/update/filesystem/process and two-device checks remain platform-contingent.
