# Grok Build Provider Parity

## Objective

Add the user's locally installed, signed-in Grok Build CLI as a third subscription-backed native engineering provider alongside Codex and Claude. Waypoint must discover Grok without requiring a reboot, speak Grok's official stable Agent Client Protocol (ACP), retain Grok's native skills/plugins/MCP/subagent behavior, and provide the same durable session, approval, streaming, cancellation, automation, packaging, and truthful-authority guarantees already required for the other local CLIs.

## Product boundaries

- Grok authentication remains owned by the user's installed CLI. Waypoint never reads, copies, exports, or persists Grok credentials and must fail before prompt release when the active identity is not the signed-in `grok.com` subscription.
- Waypoint never bundles Grok, Codex, or Claude executables. It discovers versioned user installations at standard Windows/macOS/Linux locations and from PATH; Windows discovery must work immediately after installation without a reboot or PATH refresh.
- No Waypoint AI token, output, turn, file-size, or elapsed-time cap is applied to Grok. Provider-owned limits, explicit cancellation, repository authority, redaction, approval policy, and safe process lifecycle remain enforced.
- Normal Grok chat retains its installed CLI-owned configuration, instructions, skills, plugins, MCP servers, hooks, subagents, and model catalog. Waypoint does not silently rewrite that configuration.
- Automate mode remains a hard planning boundary: direct mutable shell/file/network/external-MCP authority is disabled, and only a schema-valid Waypoint automation proposal may cross the boundary for later user confirmation. If Grok cannot prove that boundary before prompt release, Automate must fail closed.
- Preserve macOS and Linux discovery/spawn branches through source and configuration tests on Windows. Do not claim an executed macOS or Linux package test.

## Phase 1 — Discovery, ACP protocol, identity, and authority foundation

1. Extend CLI discovery with Grok Build version parsing, compatibility gates, standard per-user install paths, Explorer/taskbar sparse-PATH behavior, and a child environment that supplies `HOME`/`GROK_HOME` without exposing secrets.
2. Add the official stable ACP TypeScript client dependency and a native Grok workbench using `grok agent stdio`: initialization, signed-in-subscription preflight, session new/load/resume, exact session identity, model selection, prompt streaming, structured updates, permission requests, cancellation, process-tree shutdown, malformed-protocol failure, and audit redaction.
3. Map Chat, Developer, Full Agent, and Bypass profiles to Grok permission/sandbox options without weakening canonical selected-root validation. Structured path-bearing operations remain root-scoped; Windows host-shell authority is presented truthfully; Bypass is explicit, audited, and cancelable.
4. Prove the local installed Grok 1.0.3 account, models, a read turn, a write/approval turn, exact resume, rejection, and cancellation against disposable QA data.

Acceptance: discovery succeeds from `C:\Users\scott\.grok\bin\grok.exe` even when PATH does not contain it; incompatible versions and non-subscription auth fail before prompt release; ACP schema validation, permission drift, root replacement, session mismatch, malformed updates, and process descendants fail closed; focused tests/build/lint pass; a live signed-in disposable run proves streaming, write authority, resume, and cancellation with no credentials persisted.

## Phase 2 — Durable store, routing, renderer, and model parity

1. Extend provider/execution/session/request/model-preference schemas and migrations from two native providers to three. Preserve backup/restore, sync, reconciliation, deletion, provider-request deduplication, and legacy database behavior.
2. Wire Grok through route proposals, attachment preparation, execution lifecycle, child delegation, reflection, provider switching, active-run cancellation, chat reopening, auto-title, provider session reset, and fallback presentation without changing existing Codex/Claude behavior.
3. Add Grok to the composer and Settings with truthful availability/version/auth/model status, model choices reported by the installed CLI, persistent per-workspace model choice, authority summary, pending questions/approvals, visible assistant prose, and collapsed expandable structured activity.
4. Support ACP text and native-tool access to integrity-checked run-scoped local file snapshots truthfully; unsupported attachment types stay local with provenance rather than being guessed or silently dropped.

Acceptance: current-schema, migration, malformed-backup, sync, route, renderer, and IPC tests cover Grok; active navigation does not interrupt a Grok run; session and model choices survive restart; visible assistant output remains outside the collapsed tool chain; the real app can switch among Codex, Claude, and Grok without stale state or route confusion.

## Phase 3 — Native skills, MCP/subagents, and safe automation parity

1. Preserve leading slash-skill prompts and Grok's refreshed installed skill/plugin/subagent inventory. Require exact skill discovery before an automation can bind a Grok skill.
2. Preserve normal-chat Grok MCP behavior and surface ACP tool calls, plans, commands, file diffs, questions, failures, and subagent activity in the shared durable event model.
3. Add Grok as an automation action provider and give isolated Grok Automate sessions one schema-valid Waypoint automation proposal tool over an ephemeral local MCP connection. Disable direct mutable built-ins, web/network, configured external MCP, plugins/hooks, and inherited direct authority for that planning session; validate the boundary before releasing the prompt.
4. Extend webhook automation proposal validation, approval receipts, run startup, session lifecycle, cancellation, restart reconciliation, and exact skill execution to Grok without allowing a pending card for an impossible or unverified route.

Acceptance: an ordinary Grok PR review retains normal engineering authority while explicit Automate mode is reduced and fail-closed; a disposable Grok skill can be discovered and invoked; a schema-invalid proposal can be corrected in-turn; a valid proposal produces only a pending Waypoint confirmation card before external mutation; an approved disposable inbound rule can launch and cancel a Grok action with durable provenance.

## Phase 4 — Full gates, package closure, and installed Windows acceptance

1. Run focused and full tests, lint, build, dependency audit/signature/policy gates, diff check, backup/migration proof, and package-runtime closure.
2. Build the Windows installer and inspect the exact ASAR/resources to prove Grok is not bundled, standard-path discovery is packaged, ACP runtime dependencies close, and existing Codex/Claude/macOS/Linux packaging branches remain intact.
3. With user elevation when required, install the new package and exercise the exact installed Program Files/taskbar launch: Grok availability without reboot, signed-in model catalog, read/write/approval/Bypass, streaming, cancel, exact resume/restart, slash skill, native MCP/subagent visibility, and safe Automate proposal.
4. Run a fresh phase review and two independent whole-project adversarial reviews. Fix every valid BLOCKER/MAJOR and rerun affected/full gates.

Acceptance: exact release artifact and installed executable hashes are recorded; installed Waypoint discovers the current user Grok install without reboot; all three local providers complete their live acceptance paths; no CLI executable or credential is packaged; package closure and all required gates pass; no unresolved BLOCKER/MAJOR remains. If UAC or visual confirmation is declined, report `AWAITING_USER_VALIDATION` rather than manufacturing an installed pass.

## Review and completion gates

- Each phase receives a fresh read-only adversarial review after its complete build/runtime gate; valid BLOCKER or MAJOR findings are fixed and re-reviewed before advancing, with at most four fix cycles per phase.
- After all phases, run the full repository gate and two independent whole-project adversarial reviews concurrently.
- Completion requires no unresolved BLOCKER/MAJOR findings, truthful unavailable results, preserved pre-existing user changes, and explicit user validation for the installed Windows UI checkpoint.
