# R1 desktop sync integration gate

## Ordered slices

1. **Authority lifecycle:** durable one-use owner-approved invitations, authenticated enrollment, device listing, terminal revocation, epoch advancement, and resumable per-device key-wrap progress. No private/workspace key reaches the relay.
2. **Desktop transport:** signed TLS relay client composed in Electron main, OS-protected-key adapter boundary, explicit per-workspace enable/disable, bounded polling/cancellation/backoff, durable outbox/inbox/ack, and truthful status/device management IPC.
3. **Attachment and convergence:** chunk manifests and missing-index resume over opaque envelopes; isolated peer processes exercise messages, documents, memories/graph, conflicts, offline delete/re-enrollment, outage/recovery, and attachment interruption.
4. **Product surface:** compact sync/device controls in Settings; invitation approval and revocation require explicit confirmation; errors and incomplete rotation remain visible and retryable.

## Acceptance criteria

- Invitations are signed, workspace-scoped, expire, consume exactly once transactionally, and cannot enroll a revoked identity or substitute keys.
- Every authority mutation is owner-authorized, replay-safe, epoch-bound, and durable across relay restart. Revocation blocks future queue access immediately and rotation never strands an active peer silently.
- Desktop requests use the existing signed canonical transport over the pinned Waypoint HTTPS origin only. Private keys/workspace keys remain main-process/local; renderer sees only sanitized device/status/progress data.
- Sync retries are idempotent, bounded, cancelable, and preserve durable work through app or node outage. Deletes dominate stale/offline updates and re-enrollment uses a fresh identity/snapshot.
- Attachment chunks resume by missing indices, authenticate identity/order/size, enforce existing limits, and verify the final digest before publication.
- Automated isolated-peer tests cover tamper/replay/expiry/revocation/epoch, bidirectional online/offline changes, ordered chat messages, graph mutations, conflicts, deletion, re-enrollment, interrupted attachment, relay restart, and outage recovery.
- Focused/full tests, lint, build, dependency audit, macOS package/runtime closure, and independent security/convergence review have no unresolved blocker/high.

## Honest physical gate

The automated matrix uses isolated identities and stores/processes on the one available Mac. It is not evidence for two physical Macs, sleep/network transitions across hardware, or Windows. Those native gates remain required when hardware is available.

## First-owner trust ceremony

The relay exposes no public bootstrap route. The first desktop creates its keys in OS-protected storage and displays an opaque public bootstrap bundle (workspace ID, device ID, signing public key, encryption public key). An authorized operator applies that bundle once with `npm run relay:bootstrap-owner -- <registry> <workspaceId> <deviceId> <signingPublicKey> <encryptionPublicKey>`, verifies the diff contains no private material, and restarts only the dedicated Waypoint relay service. The command rejects an existing workspace or reused signing identity. This deliberate ceremony is the root of trust; later devices use signed one-use invitations in-product.
