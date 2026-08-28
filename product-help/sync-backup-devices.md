# Sync, backup, and devices

Waypoint can operate as a single desktop app. The Ubuntu relay is optional, not a required third component.

## Device Network

Open **Device Network** from the sidebar or the Windows tray menu to see Waypoint instances running on the same local network. Discovery is automatic and does not grant access. An unlinked device reveals only its bounded name, platform, Waypoint version, private-network endpoint, and signed endpoint fingerprint. Device public keys and operational status are exchanged only through pinned HTTPS.

Choose **Link this device** on either instance. Both computers show the same six-digit code. Confirm **Codes match · link** on both devices; no invitation code needs to be copied or pasted. Both confirmations create durable personal-device trust intent. That record never authorizes content or work by itself: each consequential request requires a new short-lived proof signed by both online devices for the exact operation, resource, and request-byte digest. The target consumes that proof once in protected storage before acting, so replay remains rejected after restart. Missing, reused, expired, asymmetric, revoked, or modified proofs fail closed. Workspace access appears only after this mutual authorization and the corresponding encrypted workspace grant, and each workspace keeps its own encryption and provenance boundaries.

Trusted cards report online, offline, working, attention, capabilities, and independent remote-work/sync pause states from authenticated, certificate-pinned device presence. You can choose a **Supervised** or **Autonomous** default for later remote tasks. **Unlink** immediately revokes this device's fleet trust without deleting workspace content already stored on either computer.

Trusted online devices publish a bounded workspace catalog after fresh mutual authorization. **Fleet knowledge** searches this device and reachable trusted devices, labels partial results when a device does not answer, and keeps the source device, workspace, object type, and revision provenance on every result. Opening a remote result fetches only that object, verifies its provenance, and stores an authenticated encrypted cache copy. **Pin cached workspace** fetches the complete declared inventory for offline use; individual attachments up to 6 MiB are included, while larger attachments are counted as omitted instead of being presented as cached. Unpinning makes those copies eligible for eviction and never deletes authoritative content.

Before a workspace can receive target-local work, open **Device Network → Remote worker profiles** on that computer and explicitly allow one or more exact authority profiles. Pairing alone does not advertise a repository or profile. You can stop advertising a profile at any time without deleting its workspace or repository.

To start target-local agent work, open **Office Command Center**, choose **Begin a task**, and select a trusted online target machine. Waypoint shows the target platform, architecture, memory, installed Codex/Claude/Grok versions, target provider model policy, authorized repositories, and the exact target security profile. Choose **Supervised** to require approval on the target before execution and for each consequential provider request, or **Autonomous** to let the target provider accept requests inside that same bounded target profile. The controller repository and workspace-write authority profile are reviewed separately from the target repository and authority profile before dispatch. Remote work uses the target provider's default model; the reviewed provider version is pinned in the order, and execution fails if that version changes before the target starts.

Coding handoff sends a verified Git bundle for a clean repository or a binary patch for tracked local changes. Untracked controller files must be staged or committed first so they cannot be silently omitted. The target works only in a managed isolated worktree; its ordinary checkout is not modified. The controller journals the exact signed order before network submission. If a response is interrupted or ambiguous, retrying the task reuses that exact idempotency key and order instead of creating duplicate target work. Completed work appears under **Device Network → Fleet work** with the returned changed paths, patch digest, and original Git base. Choose **Review returned changes** before applying. Apply verifies the original controller repository, workspace-write profile, order digest, patch digest, and Git base and fails closed if any boundary changed. You may instead **Retain on target** or **Discard isolated worktree**. Cancel, timeout, restart interruption, missing target tools, provider-version drift, and trust revocation remain durable, truthful terminal states.

Waypoint's background Device Host starts at sign-in by default. On Windows, closing the main window keeps Waypoint, discovery, sync, and allowed work running in the tray; use **Quit Waypoint** in the tray menu to stop the host. Device Network and the tray menu provide separate controls for start-at-sign-in, close-to-tray, remote-work pause, and sync pause.

## Desktop-host mode

One Waypoint desktop can act as an explicit local host for another enrolled device. Enrollment is authenticated and one-use, device identity is pinned, and the UI shows host endpoint, fingerprint, readiness, revocation, rotation, and offline state. If the host sleeps or is unreachable, direct-host work pauses truthfully; Waypoint does not claim an invisible fallback.

Use **Settings → Device sync → Invite device**. In desktop-host mode, Waypoint offers to start the host first when it is stopped, then creates a bounded one-use invitation. The token remains visibly available until dismissed and is also copied when clipboard access succeeds; clipboard denial does not discard the invitation. Invitation registration times out with an actionable error instead of leaving the button spinning indefinitely.

On the device being added, use **Join with invitation** or **Join another workspace**, paste the token, and ask the owner to approve the pending device. Waypoint creates and selects the matching local workspace when needed. Return to **Settings → Device sync** and choose **Complete approved enrollment** after approval. Joining remains available when the currently selected workspace is configured or its desktop host is offline.

Use **Leave sync on this device** to unsync only the current device. This stops its desktop host, disables its remote-worker authority, and removes its protected sync identity and pending local sync state. Workspace chats, documents, and local files remain on the device. The device record can remain on another host until an owner revokes it. A pending request can be removed with **Cancel enrollment**.

The existing hosted relay remains an optional transport for public/stable reachability, offline delivery, and signed inbound webhooks. Selecting a topology is explicit. Waypoint does not create cloud resources or change the relay automatically.

## Sync and deletion

Sync uses encrypted workspace-scoped records, canonical conflict handling, resumable bounded attachment transfer, device revocation, and key-epoch rotation/re-wrapping. Tombstones and deletion rules prevent a deleted object from being silently resurrected by an older peer.

Cross-device agent control uses target-local policy, durable exclusive leases/idempotency, cancel/Stop, status, and receipts. Preferred-device routing considers current availability, platform/tool/project needs, and user policy. It does not export target secrets or claim a Windows/Mac execution that did not happen.

## Backup and restore

Local backup export includes supported workspace-owned objects and lifecycle records but excludes protected provider keys and device-only secrets. Verification and restore drills inspect backups in an isolated temporary path. A drill does not replace the live database.

Restored queued/running operations do not silently regain authority. The app reconciles them to a safe terminal or paused state. Help resources themselves are bundled app content and are not part of workspace backup.

## Current limitations

Two physical-device convergence and native Mac-to-Windows execution remain physical acceptance gates. Signing, notarization, installer/update distribution, and automatic relay fallback require separate release or policy decisions.

## Privacy and data handling

Workspace encryption keys and protected provider secrets are not placed in ordinary receipts. Device enrollment, revocation, and security-critical permissions are user-only controls. Sync does not merge raw data across different workspaces.
