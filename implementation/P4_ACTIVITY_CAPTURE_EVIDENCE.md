# P4 Recall-style Activity Timeline — terminal evidence

Date: 2026-08-03

## Outcome

Phase A passed its Build-to-Complete gate as a privacy-first production foundation. It ships a default-off, restart-durable policy and viewer/search/lifecycle UI, fixture-tested snapshot persistence, configurable 90/183/365-day retention, exclusions, immediate pause/stop, exact provenance, explicit private preview, opt-in encrypted attachment sync, backup/restore, and hard deletion with anti-resurrection tombstones. Native capture remains a truthful unavailable readiness seam: no screen permission was requested and no real screen was captured.

## Verification

- Focused final gate: 3 suites / 17 tests, lint, build, diff hygiene.
- Full gate: 86 suites / 396 tests; zero dependency vulnerabilities and undeclared licenses; macOS arm64 package and packaged runtime closure passed.
- Isolated-profile packaged app launched and the primary responsive shell was visually inspected. Host assistive-access restrictions prevented scripted drawer navigation; no real capture permission or user data was used.
- Coverage includes default-off/restart pause, exclusion/sensitive/lock/sleep/app-change/low-disk/malformed/stale decisions, latest-policy commit race, UTC expiry, search/storage/read scoping, raw receipt minimization, backup opt-in/paused restore, inbound opt-out, manifest/digest/MIME binding, resumable chunk completion, sync-on→off deletion, and attachment/file cleanup.

## Independent review

Initial verdict: NO-SHIP — 0 blocker / 4 high / 3 medium / 2 low. Repairs made tombstones independent of current sync preference, reran full policy at commit, failed closed on recipient opt-out, added exact private viewing, bound snapshot/attachment provenance through completion, made sync state durable, expanded two-peer fixture coverage, and cleared preview bytes when the drawer closes.

Final verdict: **SHIP — 0 blocker / 0 high / 0 medium / 0 low**.

## Honest residual gates

- This phase does not start native screen capture. A later explicit user-consented macOS permission/live-runtime test is required before capture can become available.
- Windows capture/package/hardware validation and two-physical-device snapshot convergence remain platform/device gates.
- No relay, DNS, firewall, Caddy, PostgreSQL, cloud resource, or external service was changed.
