# P6C Tool Failure Learning / Prevention — acceptance evidence

Date: 2026-08-03

## Delivered

- Workspace-scoped, content-minimized failure knowledge keyed by normalized tool, capability/fingerprint-key version, HMAC parameter fingerprint, OS context digest, error class, remediation, outcome, expiry, source receipt, and supersession lineage.
- Preflight pauses a materially equivalent active failure and returns the prior safe remedy. Retry requires a 20–300 character explicit reason; a later equivalent success supersedes the failure.
- Only genuinely executed failures/timeouts learn. Malformed requests, policy denials, preflight denials, invalid overrides, and pre-execution validation failures create truthful receipts without poisoning failure knowledge.
- Unsynced local workspaces use an OS-protected device key, preserving same-device backup/restore matching. Enrolled peers derive the same HMAC key from the protected shared workspace key; key epoch is part of capability provenance and rotation invalidates stale matches.
- Seven-day expiry and 50-per-tool/workspace retention physically delete rows and emit sync tombstones. Source receipt and workspace deletion cascade; manual deletion is visible and sync-compatible.
- Backup/restore and canonical sync carry only opaque fingerprints and bounded provenance. Inbound/archive validation enforces canonical ISO dates/order, source/supersession identities, matching failed/timed-out receipt tool/capability, bounds, and workspace isolation.
- Settings UI shows active/superseded warnings, remediation, reasoned-retry status, expiry, and deletion without raw commands, prompts, arguments, output, environment values, or secrets.

## Verification

- Focused repaired gate: 6 files / 54 tests passed.
- Final full repository gate: 75 files / 352 tests passed.
- ESLint, TypeScript/Vite build, dependency verification, SBOM, macOS arm64 package, packaged runtime closure, isolated native launch, and diff check passed.
- Docker, external services/accounts, hosted providers, browser automation, unrestricted AI terminal, peers, deployments, and user workspaces were not used.

## Independent review

Initial verdict: NO-SHIP — 0 blocker, 3 high, 2 medium. Repairs added enrolled-peer key portability/epoch provenance, journaled physical retention purge, executed-only learning, policy-secret note redaction, and strict provenance validation.

First re-review: SHIP — 0 blocker, 0 high, 2 medium, 1 low. The remaining source-receipt, canonical timestamp, and deterministic tie-order findings were also repaired before final re-review.

A later spot-check found that full replacement snapshots did not yet carry the incremental supersession receipt provenance. Both paths now use one minimized payload builder, with full-snapshot regression coverage and strict completed same-tool/base-capability validation on inbound and archive restore. Final independent verdict: **SHIP — 0 blocker, 0 high, 0 medium, 0 low**.

Windows verification remains platform-contingent. Cross-device behavior is automated through minimized canonical sync payloads; two physical devices remain deferred under the standing roadmap decision.
