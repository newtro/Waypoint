# Waypoint provider A/B and Tool Gateway readiness plan

Status: planning-only, 2026-08-03. No provider activation, API key, model usage/download, external account, terminal execution, browser session, or implementation is authorized by this document.

## P6A — policy-bounded paired provider evaluation

Build a user-triggered harness that presents the same sanitized, versioned task envelope to two compatible candidates—for example Kimi K3 versus Codex or Claude—and compares results without duplicating effects. The default is read-only evaluation or separate disposable worktrees/sandboxes. Live side-effect comparison is unavailable until a separately explicit policy is approved.

Acceptance:

- Record fixture/task-envelope digest, provider/model/version, route/profile, time to first result, completion time, known cost, tool requests/effects/denials, task/test outcome, structured errors/fallback, independent review verdict, and optional user preference.
- Bound prompt/output retention, redact stored content and receipts, isolate workspace/client/worktree, support stop/cancel, and enforce finite concurrency, duration, output, disk, network, and cost budgets.
- Reproducible fixtures prove equivalent inputs, nondeterminism disclosure, cancellation/race recovery, provider failure, partial streams, conflicting verdicts, budget exhaustion, deletion, and backup/restore.
- Results may create explainable routing suggestions only; they cannot modify routing or policy autonomously.
- Kimi K3 remains an optional strategic coordinator, Codex/Claude remain subscription-first CLI workers, and DeepSeek V4 Flash remains an optional hosted routine lane. No API key, OpenRouter activation, paid call, or model activation occurs in the local slice.

## P6B — model-neutral Tool Gateway / Agent Runtime

Add normalized OpenRouter-compatible function-call adapters for providers whose tool loop is not already encapsulated. Codex and Claude Code continue using their own reviewed CLI tool loops; Waypoint does not reimplement them. Every gateway request crosses a policy enforcement point in the trusted Electron main process. A provider can request a named typed capability, but can never obtain direct provider-controlled shell, browser, filesystem, credential, or peer access.

The trusted main process also exposes one policy-governed internal domain-command surface shared by UI and AI. The UI is an observability/manual-fallback client, not a separate privileged implementation. Within effective authority, the AI can perform every ordinary Waypoint task and change every non-security setting the UI can, including creating/managing an already-authorized Waypoint webhook/task flow. Security-critical configuration, authority widening, credential creation/import, tenant/app registration, permissions, external endpoint ownership, and destructive security lifecycle remain explicit user-only commands.

Acceptance:

- Versioned tool schemas and capability discovery produce normalized, content-minimized receipts containing tool/version, workspace/client/device, policy/profile digest, request/effect/denial, start/end/status, resource use, provenance, and rollback reference where meaningful.
- UI and AI calls resolve to the same typed domain commands, validation, transactions, status model, idempotency, receipts, provenance, rollback semantics, workspace boundary, and global stop. Contract tests prove parity and prevent a hidden UI-only or AI-only authority path.
- Target-device work uses a signed, finite, replay-resistant job lease. The target revalidates workspace epoch, device status, roots, profile, tool version, budgets, cancellation, and current revocation at every execution boundary.
- Streamed progress, cancel/retry/failure, global stop, activity timeline, hard deletion, backup/restore, output minimization/redaction, and finite time/concurrency/output/disk/network/attachment budgets are mandatory.
- A/B execution uses isolated project worktrees by default. Tool groups advance only through reviewed gates: read/search/list metadata/Git diff; edit/apply patch; test/build; terminal; browser/issue tools only when separately authorized.
- Hostile-model/tool-output tests cover malformed/nested schemas, excessive arguments, path/symlink escapes, command injection, terminal control sequences, prompt injection, cross-workspace/client/device crossover, stale/replayed leases, cancel races, quota exhaustion, concurrent jobs, cross-device revocation, result exfiltration, and deletion.

## Local CLI capability policy

For Git, GitHub, Azure DevOps, and comparable developer/work-item systems, prefer one generic policy-governed local CLI adapter that invokes the selected device's installed, already-authenticated tools (`git`, `gh`, Azure DevOps CLI/tooling, and similar). Discover exact executable/version/capabilities and use the user's established local identity. Do not build duplicate OAuth/PAT storage or direct connector authentication by default; direct APIs are a later fallback only when no suitable local CLI exists or a requirement explicitly demands one.

An AI may configure a Waypoint-side Azure DevOps or comparable webhook/task flow only after the external endpoint/account permission already exists within explicit authority. It cannot register an external app, mint/store a new credential, widen tenant scopes, or bypass user/employer approval. Missing authority produces a truthful blocked command receipt and exact user action—not a simulated success.

In a trusted workspace under the Autonomous Developer profile:

- Terminal access is unrestricted by default and inherits the normal local environment and Keychain access so installed developer tooling works. A user-managed deny list—not an allowlist—blocks commands/patterns; task and workspace policy may add denials.
- Existing secret-bearing environment variables and Keychain-backed authentication may be consumed locally but passwords, cookies, tokens, Keychain values, and secret-bearing environment values are never surfaced, logged, stored in receipts, exported, sent to a provider, or relayed to another device.
- Git commit and push may be policy-default actions with a clear user-visible notification. Per-task instructions can suppress either. PR create/update and every deployment require an explicit user request.
- Command policy state, effective denials, environment-inheritance state, device, root/worktree, and resulting sanitized receipts remain visible. Global stop and cancellation dominate all jobs.

## Browser policy

Browser control is an explicit per-invocation/workspace choice: use the user's existing signed-in browser profile for local convenience, or an isolated dedicated Waypoint profile for separation. The active choice is visible before and during execution and recorded in the sanitized receipt. Both modes honor workspace policy, cancellation, global stop, navigation/output bounds, and audit. Waypoint never extracts, displays, logs, exports, or relays passwords, cookies, session tokens, or other browser secrets. Browser and issue-system actions remain unavailable until their own reviewed capability/authority gate.

## Activation gates

Implementation may begin as local schemas, simulator, policy engine, hostile fixtures, and no-effect UI. Any OpenRouter/API/provider credential, paid model, external account/data, live browser session, network access, cross-device execution, PR, write/send, or deployment requires its documented explicit authority. Trusted-workspace defaults do not override a task instruction, workspace/client boundary, deny rule, global stop, or the separate PR/deployment gate.
