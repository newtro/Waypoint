# P5 cross-device command control — evidence

## Delivered boundary

- Added a native, Docker-free controller/worker protocol over the existing end-to-end encrypted sync pump.
- The production capability is intentionally limited to a user-dispatched `waypoint.workspace_summary` domain command. Remote terminal, remote Codex/Claude CLI agents, browser control, and Windows execution remain visibly unavailable.
- Worker enablement and every worker-policy change require an explicit user confirmation. Controller dispatch remains independent of the controller's worker state.
- Jobs have canonical idempotency identity, target/epoch/capability bounds, current target peer-eligible profile binding, finite exclusive leases, durable events, cancel/timeout/recovery, minimized results, backup/restore, hard deletion, and sync tombstones.

## Verification

- Focused repaired gate: 4 suites / 41 tests passed; lint and production build passed.
- Full repaired gate: 88 suites / 405 tests passed.
- Dependency gate: 0 audit vulnerabilities; 0 undeclared licenses.
- Native macOS arm64 directory package succeeded; packaged runtime import closure passed.
- Isolated encrypted peer test proves the remote mutation is opaque on the relay wire, targeted only to the selected worker, decrypted by that identity, and applied as a remote job.
- No relay, VM, Caddy, PostgreSQL, DNS, firewall, account, credential, or user-workspace change occurred.

## Deferred physical gates

- Two physical Macs, Windows dispatch/build behavior, presence advertisement, and real remote Codex/Claude agent delegation are not claimed. They remain required before cross-device release readiness.
- macOS signing remains unavailable locally; the package is an unsigned test build.

## Review

- Initial independent verdict: NO-SHIP, 0 blocker / 5 high / 1 medium / 0 low.
- Repairs addressed controller cancel/global stop, stable idempotency, target policy binding, encrypted peer coverage, truthful UI/controller-worker separation, event visibility, and confirmation of all policy changes.
- Final independent verdict: SHIP, 0 blocker / 0 high / 2 medium / 0 low.
- Residual non-gating mediums: preferred/failover routing with authenticated live worker advertisement remains deferred; target policy is bound at immediate claim but is not yet a persisted/resumable long-running lease contract.
- Final independent P4+P5 whole-program verdict: SHIP, 0 blocker / 0 high / 2 medium / 0 low; no cross-feature privacy, global-stop, lifecycle, deletion, sync, backup, or UI-truthfulness interaction was release-stopping.
