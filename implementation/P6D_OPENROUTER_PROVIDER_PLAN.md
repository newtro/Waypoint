# P6D — OpenRouter provider vertical slice

## Scope and authority

Add an optional globally configured OpenRouter provider without making a live or paid request during implementation. The API key is entered and removed only by the user in Settings and is held in Electron `safeStorage`; it never enters SQLite, renderer state, logs, receipts, sync, backup, export, or relay traffic. Hosted routing remains disabled until the key exists, the provider is enabled, and the user explicitly enables hosted requests.

## Acceptance gate

1. Settings exposes truthful no-key/disabled/ready-unverified states, user-only secret set/remove, provider enablement, hosted-request activation, strategic/everyday model IDs, fallback preference, monthly/YTD caps, and warning threshold. Ordinary non-secret preferences use the shared domain-command seam; credential and activation changes remain user-only.
2. Kimi K3 and DeepSeek V4 Flash are route roles, not availability claims. Exact user-selected OpenRouter model IDs and the last verified model/provider response are recorded in content-minimized provenance.
3. A main-process policy engine blocks calls without protected key + enablement + explicit hosted activation + model + budget. Cap exhaustion may fall back only to a pre-approved available Codex/Claude subscription route; it never widens workspace, profile, input, device, or tool authority.
4. Integer-microdollar usage receipts provide current-month and YTD totals and provider/model/workspace breakdowns, warning/cap/remaining/projected states, cancellation/failure status, and a neutral seam for future A/B evaluation. Receipts contain no prompts, output, tool arguments, or secrets.
5. Workspace-owned receipts cascade on deletion and participate in workspace export/restore and sync; global preferences may be backed up without the secret, while the protected key is deliberately excluded.
6. Fixture/contract transport proves success, failure, malformed response, cancellation, cap, fallback, aggregation, no-key, disabled, and no-live-call behavior. Full tests, lint, build, audit/SBOM, native package/runtime checks pass. No real provider call is made.
7. Independent adversarial review reports explicit severities; all blocker/high findings are repaired and reverified before commit/push.

Executor: primary task. Reviewer: fresh independent context receiving this gate and the exact diff. Windows secret-store/package behavior remains platform-contingent.
