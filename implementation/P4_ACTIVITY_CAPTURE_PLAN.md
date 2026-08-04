# P4 Recall-style Activity Timeline — acceptance gate

## Security profile and phase boundary

Local personal workspace; capture is default-off. Verification uses synthetic fixture frames only. No real screen-capture permission prompt, capture, OCR, cloud API, browser automation, user workspace, external storage, or new relay change is authorized. macOS capture is exposed as a packaged readiness seam and remains unavailable until explicit OS consent and a later live user test; Windows is platform-contingent.

## Acceptance

1. A workspace-scoped, restart-durable policy defaults to paused and requires an explicit preview/enable action. State is always visible. Pause/Stop is keyboard accessible, dominates in-flight persistence, never backfills, and survives restart.
2. Whole-device is the explicit enabled default. Per-app bundle/process exclusions, conservative sensitive/system exclusions, locked/sleep state, and current app identity are evaluated before bytes are persisted. An app-identity change during a capture invalidates the frame.
3. Raw activity is periodic snapshots, never video. Every accepted snapshot has exact captured-at, local device, source/display/app identity, policy version, decision, SHA-256, retention deadline, and bounded searchable metadata. Normal activity receipts expose no title/OCR/body/path/hash.
4. Retention is user-selectable (90 days, 6 months, 1 year), with deterministic UTC expiry, storage meter, delete-one, delete-all, and purge-now. Pause/exclusion/expiry/delete hard-remove raw files and derived snapshot metadata.
5. Raw activity sync is separately opt-in per workspace, reuses encrypted mutation/attachment transport with bounded/resumable chunks, and defaults off. Delete/expiry emits durable tombstones so stale peer data cannot resurrect. No external storage is added and no two-physical-device claim is made.
6. Backup/restore includes raw snapshots only when the workspace capture-sync/backup choice is enabled, validates bytes/provenance, and preserves retention. Default exports do not silently include whole-device history.
7. The chat-first UI provides settings, permission/readiness truth, prominent Pause/Resume/Stop, exclusions, retention/sync choice, storage, search/navigation, provenance, and deletion at practical desktop widths with accessible labels/status.
8. Tests cover policy validation, pause/exclusion/app-change races, sensitive/lock/sleep/low-disk/malformed frames, retention clock boundaries, unavailable indexing, workspace isolation, backup/restore, encrypted sync/resumption contracts, deletion/anti-resurrection, and no receipt leakage.

## Gate

Focused and full tests, lint/build, dependency audit, native macOS package/runtime launch and visual inspection, explicit independent severity-rated review, repair/reverify until no blocker/high, evidence, decision/timeline updates, then commit/push. Phase B cannot begin before this gate is clean.
