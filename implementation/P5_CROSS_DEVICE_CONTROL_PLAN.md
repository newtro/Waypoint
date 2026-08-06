# P5 Cross-device command and agent control — acceptance gate

## Security profile and phase boundary

Native/no-Docker desktop phase atop a transport-neutral encrypted peer protocol. Verification uses isolated identities/processes and a local desktop-host fixture first. The existing dedicated relay is an optional transport and is used only where its store-and-forward/public-reachability behavior is under test. No VM change, Windows or second-physical-Mac claim, external account, new cloud resource, DNS/firewall/Caddy/PostgreSQL change, arbitrary AI-origin remote terminal, deployment, PR, or user workspace is authorized.

## Ordered transport slices

1. **Transport contract:** split enrollment, device registry, rotation, opaque message queue, presence, and job transport from `DesktopRelayClient`. Preserve the hosted implementation unchanged behind `hosted-relay`; add `desktop-host` capability/status types and deterministic no-fallback routing.
2. **Peer host runtime:** explicit user-only start/stop; bind only a selected local interface; generate and protect a host identity/certificate; pin it in one-time invitations; mutual enrolled-device request authentication; reuse bounded authority/message services without webhook routes; immediate shutdown on stop/quit and truthful sleep/network-change status.
3. **Direct enrollment:** invitation carries topology/version, host endpoint candidates, host pin, workspace/owner identity, one-time secret digest, epoch, and expiry. The applicant verifies the displayed fingerprint before submitting; approval wraps the existing workspace key to the applicant device. Revocation and rotation invalidate direct and relay paths consistently.
4. **Selection and fallback:** prefer active local device, then explicit direct peer. Optional relay fallback is a separate user setting and is considered only after a bounded direct failure. Host-offline state queues encrypted changes locally; without relay, no offline delivery is claimed.
5. **Agent execution:** advertise signed, expiring worker health/capabilities through the selected transport; issue policy-bound resumable leases; return bounded results/receipts; enforce target-local stop, profile, roots, tools, budgets, revocation, and epoch on every resume.
6. **Validation:** isolated same-machine host/client, packaged Mac host, packaged Windows client, sleep/wake, interface changes, hostile LAN, replay, stale pins, revocation/rotation, direct-to-relay fallback, relay-to-direct recovery, conflicts, deletion, and anti-resurrection. Physical-device evidence remains explicit.

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
11. The app works normally with no sync transport configured. Starting peer-host mode is explicit; stopping it does not disable local features. Public webhook setup explains that it requires the optional hosted relay/public endpoint.
12. Transport receipts and UI always identify `local`, `desktop-host`, or `hosted-relay`. No automatic topology switch occurs without the saved workspace fallback policy.

## Desktop-host implementation evidence — 2026-08-06

- Shipped explicit desktop-host start/stop and visible endpoint, certificate fingerprint, transport mode, offline behavior, and relay-only webhook boundary.
- Host identity is OS-protected, certificate-pinned, leaf-only, stable across ordinary restarts, and deliberately rotated with a re-enrollment warning if its address/SAN or expiry becomes unusable.
- The existing signed, replay-bounded enrollment/device/rotation/opaque-message services run on a loopback kernel behind a bounded LAN HTTPS listener. The VM, DNS, Caddy, PostgreSQL, and firewall were unchanged.
- Isolated owner/peer stores prove one-use enrollment, approval, wrapped-key delivery, two active identities, outage failure, stable endpoint/pin restart, and peer reconnection without the hosted relay.
- Full 481-test suite, lint, build, dependency policy, zero-vulnerability audit, packaged macOS runtime closure, and independent adversarial repair/re-review form the phase gate. Physical Mac↔Windows, hostile-LAN, sleep/wake, and two-running-instance field validation remain truthful release gates.
