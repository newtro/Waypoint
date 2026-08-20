# Automation Agent Runtime Repair

## Objective

Make a Bypass-permissions Claude or Codex chat able to prepare a truthful, complete webhook automation from the installed Windows app: preserve full provider conversation continuity, keep Waypoint's native automation tool available across turns, execute the user's installed `az`/`gh` CLI safely on Windows, plan the Waypoint receiver and provider hook as one approval transaction, and expose immutable execution authority in chat history.

## Authority and non-goals

- Preserve provider-native token, output, file-size, and time behavior; Waypoint must not add AI-run limits.
- Preserve the workspace root as the process working directory and session binding, the explicit profile, provider identity, durable audit, secret redaction, cancellation, and rollback boundaries. Structured file/web tools retain profile scope. On Windows, native shell and PowerShell are truthfully host authority because provider sandbox containment is unavailable: Developer/Full Agent require command approval; Bypass deliberately matches direct Claude/Codex YOLO authority without prompts. The UI must say so rather than claim containment.
- Do not create a real Azure DevOps or GitHub webhook during QA. Use read-only discovery, deterministic fakes, and disposable Waypoint receiver state unless the user separately requests the external write.
- Do not weaken macOS/Linux paths while repairing Windows CLI shims.
- Do not manufacture public reachability. If Desktop Sync/relay is unavailable, ask for or report that gate before approval.

## Phase 1 — Windows CLI and Claude MCP continuity

### Task 1.1 — Safe installed CLI invocation

- Resolve native executables directly.
- For the Microsoft Azure CLI MSI `az.cmd` shim, verify its bounded adjacent installer layout and launch the exact adjacent `python.exe -IBm azure.cli` entry point without a shell.
- Reject unsupported command shims truthfully rather than using an injectable shell command string.
- Prove the actual installed Azure CLI can complete read-only target discovery from the Tool Gateway.

### Task 1.2 — Reattach Waypoint MCP on resumed Claude sessions

- Preserve the exact Claude provider session identity and context; a resumed CLI that reports a different session ID fails closed.
- Before releasing the next prompt on a resumed session, dynamically re-register the in-process Waypoint MCP server and verify it is connected.
- Fail before the model turn with a truthful diagnostic if reattachment cannot be proven.
- Refresh skill/command inventory when a skill was created during the prior turn.

### Acceptance

- A fresh and resumed Claude run both initialize with the Waypoint MCP server and native proposal tool.
- A resumed run can call the native proposal tool without losing prior conversation context.
- A Bypass run retains direct-CLI host authority while still routing Waypoint questions and exact automation skill/MCP invariants through the native hook.
- Windows `az.cmd` no longer produces `spawn EINVAL`; read-only project/repository discovery returns stable IDs.
- Focused tests, build, lint, and a live installed-CLI proof pass.

## Phase 2 — Complete Waypoint receiver and proposal transaction

### Task 2.1 — Explicit two-sided proposal contract

- Require the provider explanation and confirmation card to name the Waypoint receiver/channel, reachability, signing-secret boundary, provider hook, AI route, and verification/rollback behavior.
- Never describe an automation as ready when delivery is `not_configured`.
- Use a native user question/gate when public relay configuration is required.

### Task 2.2 — Atomic approval workflow

- Plan an exact channel ID and trusted endpoint before approval when relay is configured.
- On approval: create the Waypoint receiver, retrieve the protected signing material, create and reconcile the provider hook, persist/enable the exact automation rule, then verify durable receipts.
- On any partial/uncertain failure, preserve provenance and expose exact rollback/reconciliation instructions.
- An impossible proposal must remain actionable or fail truthfully before approval; it must never strand an approved record.

### Task 2.3 — Historical authority truthfulness

- Submit the exact controlled profile selection shown in the composer.
- Show the immutable profile and model used by every execution in chat history.

### Acceptance

- A deterministic Azure DevOps proposal with configured relay includes an exact Waypoint receiver and provider target and can traverse approval through applied rule state using fakes.
- An unconfigured relay produces a clear receiver prerequisite and no approval mutation.
- UI and durable records agree on provider, model, profile, receiver, endpoint reachability, provider hook, rule, and outcome.

## Phase 3 — Windows packaged acceptance and final gates

- Run the full test, build, lint, migration, dependency-policy, and package-runtime suites.
- Build the Windows installer, install/update Waypoint, and launch the installed executable through its normal profile.
- Exercise a disposable Bypass Claude chat across two turns, confirm Waypoint MCP remains connected, and run read-only `az` discovery through the native automation proposal path.
- Inspect the visible execution header and receiver prerequisite/confirmation UI.
- Run one fresh adversarial review per phase and two independent whole-project reviews; fix all valid BLOCKER/MAJOR findings.
