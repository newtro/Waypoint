# P6D OpenRouter Provider — Evidence

Date: 2026-08-03

## Outcome

- Added an explicitly configured OpenRouter route backed by OS-protected secret storage; no key is shown, logged, backed up, synced, or entered on the user's behalf.
- Added strategic/everyday model preferences, explicit provider/live activation, monthly/YTD/per-request budgets, warning/projection views, provider/model/workspace cost aggregation, and pre-approved Codex/Claude subscription fallback.
- Connected hosted chat invocation, cancellation, durable run/receipt provenance, settings observability, backup/restore, incremental and replacement sync, and the shared non-security domain-command seam.
- Fixture transport covers success, failure, cancellation, output bounds, concurrent reservations, provider-enforced token/max-price constraints, authoritative over-cap accounting, fallback, backup, and replacement-peer cap history. No paid/live request was made.

## Gate

- Focused repair gate: 3 suites / 37 tests, lint, build.
- Full gate: 78 suites / 365 tests; lint/build; dependency audit (0 high vulnerabilities); macOS arm64 package; packaged runtime closure; diff hygiene.
- Independent final verdict: **SHIP — 0 blocker, 0 high, 2 medium, 0 low**.

## Residual non-gating work

- Make hosted-run finalization transactional across receipt, run state, assistant message, and terminal event.
- Forward bounded provider transport progress into durable hosted-run events. Current timeline truthfully shows policy, start, and terminal state only.
- A real API-key health/cost validation remains a user-triggered post-build action after the user enters a key and explicitly enables live hosted requests.
