# P1 local proactive triggers and webhook lab — evidence

Status: complete, 2026-08-03.

## Outcome

- Added workspace-owned, versioned local fixture events, suggested/paused rules, zero-effect dry runs, bounded retry/dead-letter history, a visible global kill switch, deletion cascades, and chat-first Automations controls.
- The authority contract is simulation-only: no bound listener, public ingress, schedule, account, network request, model invocation, external action, or unattended execution path exists.
- Exact event, rule, and run provenance is recomputed before display, approval, execution, export/restore acceptance, or retry. Non-record, authority-shaped, stale, replayed, malformed, oversized, cross-workspace, and tampered inputs fail closed.
- Schema 16, backup/restore, inspection/drill counts, and deletion ownership include the four local-trigger families. A real schema-15 migration preserves existing workspace data.

## Verification and review

- Final repository gate: 71 test files / 326 tests, ESLint, TypeScript/Vite production build, zero reported high-severity dependency vulnerabilities, native arm64 macOS directory package, packaged runtime import closure, isolated-profile native launch, and diff hygiene passed.
- Independent review initially found one high, two mediums, and one low. Repairs added exact stored event/rule provenance, strict event grammar, separate successful/retry idempotency, terminal dead letters, and a real migration test.
- Follow-up review found authority-shaped/non-record payload acceptance and unverified run history. Repairs added plain-record and authority-key rejection plus exact run status, attempt, zero-effect, digest, event binding, and timestamp validation.
- Final independent verdict: **SHIP — blocker 0 / high 0 / medium 0 / low 0**.

## Deferred authority

Public webhook ingress, TLS/DNS/secrets, real senders/accounts/data, schedules, outbound effects, and unattended policy stages remain unavailable and require their separately documented activation gate.
