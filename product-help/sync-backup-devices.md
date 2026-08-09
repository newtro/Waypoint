# Sync, backup, and devices

Waypoint can operate as a single desktop app. The Ubuntu relay is optional, not a required third component.

## Desktop-host mode

One Waypoint desktop can act as an explicit local host for another enrolled device. Enrollment is authenticated and one-use, device identity is pinned, and the UI shows host endpoint, fingerprint, readiness, revocation, rotation, and offline state. If the host sleeps or is unreachable, direct-host work pauses truthfully; Waypoint does not claim an invisible fallback.

The existing hosted relay remains an optional transport for public/stable reachability, offline delivery, and signed inbound webhooks. Selecting a topology is explicit. Waypoint does not create cloud resources or change the relay automatically.

## Sync and deletion

Sync uses encrypted workspace-scoped records, canonical conflict handling, resumable bounded attachment transfer, device revocation, and key-epoch rotation/re-wrapping. Tombstones and deletion rules prevent a deleted object from being silently resurrected by an older peer.

Cross-device agent control uses target-local policy, durable exclusive leases/idempotency, cancel/Stop, status, and receipts. Preferred-device routing considers current availability, platform/tool/project needs, and user policy. It does not export target secrets or claim a Windows/Mac execution that did not happen.

## Backup and restore

Local backup export includes supported workspace-owned objects and lifecycle records but excludes protected provider keys and device-only secrets. Verification and restore drills inspect backups in an isolated temporary path. A drill does not replace the live database.

Restored queued/running operations do not silently regain authority. The app reconciles them to a safe terminal or paused state. Help resources themselves are bundled app content and are not part of workspace backup.

## Current limitations

Real two-running-instance convergence, two physical devices, and native Mac-to-Windows execution remain physical acceptance gates. Signing, notarization, installer/update distribution, and automatic relay fallback require separate release or policy decisions.

## Privacy and data handling

Workspace encryption keys and protected provider secrets are not placed in ordinary receipts. Device enrollment, revocation, and security-critical permissions are user-only controls. Sync does not merge raw data across different workspaces.
