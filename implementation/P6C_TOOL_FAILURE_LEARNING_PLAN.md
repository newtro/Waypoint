# P6C — Tool Failure Learning / Prevention vertical slice

## Scope

Build a local, workspace-scoped preflight layer on P6B receipts. It recognizes a materially equivalent active failure using a protected keyed fingerprint, explains the prior error/remedy, and requires an explicit bounded override reason before retry. It never widens tool authority, activates a provider, executes a remedy automatically, or stores raw commands, prompts, arguments, output, environment values, or credentials.

## Acceptance gate

1. A v19 schema persists bounded failure knowledge with workspace/client scope, normalized tool/capability version, keyed parameter fingerprint, context digest, error class, source receipt, remediation/outcome, expiry, supersession, and timestamps.
2. Fingerprints are deterministic only with the protected local key; stored rows and backup/sync payloads cannot recover raw parameters or secrets. Equivalent inputs match; material parameter, tool-version, or context changes do not.
3. Gateway preflight denies an active equivalent retry with a truthful receipt and safe remedy. User or AI override requires an explicit bounded reason. Global stop, security policy, and current AI terminal prohibition remain dominant.
4. Failed/timed-out execution learns or refreshes a bounded active record. A later successful equivalent execution supersedes it. Expiry and version/context mismatch deterministically restore retry eligibility.
5. Retention is bounded by age and 50 rows per tool/workspace. Source receipt deletion cascades. Workspace deletion, backup/restore, canonical encrypted-sync payloads, and conflict behavior preserve isolation and minimized provenance.
6. Settings/status UI shows active/superseded knowledge, preflight reason/remedy/expiry and override/success receipts without exposing raw parameters. Deletion is reachable.
7. Deterministic tests cover equivalence, secret resistance, invalidation, expiry, override reason, success supersession, retention, tampering, concurrency/idempotence, deletion, backup/restore, sync, and cross-workspace isolation.
8. Focused and full tests, lint/build, dependency/SBOM, macOS package/runtime launch, and diff checks pass. Independent review has no unresolved blocker/high. Windows remains platform-contingent.

Executor: primary task. Reviewer: fresh independent context given this plan and exact diff. Stop control: existing per-workspace gateway stop remains dominant.
