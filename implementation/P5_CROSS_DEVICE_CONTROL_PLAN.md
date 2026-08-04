# P5 Cross-device command and agent control — acceptance gate

## Security profile and phase boundary

Native/no-Docker desktop phase atop the existing encrypted peer/relay protocol. Verification uses isolated identities/processes on one Mac plus the existing dedicated relay only if needed. No Windows or second-physical-Mac claim, external account, new credential, new cloud resource, DNS/firewall/Caddy/PostgreSQL change, arbitrary AI-origin remote terminal, deployment, PR, or user workspace is authorized.

## Acceptance

1. Every enrolled device can be a controller and may become a worker after explicit local enablement. UI shows enrolled identity, queue/lease/run/terminal history, provenance, cancel/stop, and precise capability/presence limitations; it never infers another peer's worker state.
2. Routing prefers the active local machine unless platform/toolchain/project/capacity requires a trusted peer. Workspace/user preference may select a peer. Failover occurs only when enabled and the selected target is unavailable; it never widens workspace/profile/tool/provider/data authority.
3. Security-critical worker enablement, pairing, device permission, allowed capabilities, and failover are explicit user-only operations. Ordinary preferences and user-authorized task creation use a shared typed domain-command seam. AI-origin dispatch remains unavailable until a separately reviewed authority profile exists.
4. Commands use normalized bounded envelopes and target-issued finite, exclusive leases bound to workspace/job/target/profile digest/capabilities/epoch/expiry. Idempotency, claim/renew/expiry/replay/revocation, restart recovery, duplicate delivery, lost response, offline queue, cancellation, timeout, and deterministic no-failover are covered.
5. The target revalidates current enrollment/revocation, workspace epoch, worker policy, profile digest, roots/capability, global stop, deny patterns, concurrency/time/output budgets, and selected local CLI availability. Local environment/Keychain may be consumed only by an explicitly enabled trusted worker and secrets are never serialized, logged, relayed, or returned.
6. Initial production capability is deliberately narrow: the user-initiated read-only Waypoint workspace-summary domain command. Signed-in Codex/Claude remote delegation, generic remote CLI/Git tooling, provider/AI remote shell, platform-specific routing, and advertised presence remain typed unavailable until their own reviewed gates.
7. Job request/progress/result/cancel mutations use existing end-to-end encryption and durable sync/relay queues. Receipts are content-minimized; task/result content stays in the encrypted job record, bounded and workspace-owned. Hard deletion cascades job events/results and emits anti-resurrection tombstones.
8. Global stop cancels active local work and prevents claim. Offline commands remain queued; cancel wins over late completion. Physical-device and Windows examples are modeled and tested without false execution claims.
9. Backup/restore, workspace isolation, replacement snapshots, sync conflict handling, and deletion include jobs/policies/preferences without exporting secrets or local environment.
10. Focused/full tests, native package/UI responsiveness/accessibility, independent severity-rated review and repair are clean before commit/push. Then a separate whole-program review covers P4 privacy/lifecycle plus P5 lease/cancel/sync integration.
