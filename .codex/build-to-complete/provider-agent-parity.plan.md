# Provider Agent Parity

## Objective

Make Waypoint a capable single desktop interface for subscription-backed Codex and Claude Code plus protected-key OpenRouter. Replace the current read-only/tool-disabled one-shot wrappers with durable, provider-native agent sessions, explicit repository authority, user-visible approvals and questions, complete structured tool streaming, and automation-safe skill invocation.

## Product boundaries

- Codex and Claude authentication remains owned by each locally installed CLI. Waypoint never reads or persists their credentials.
- OpenRouter remains opt-in and uses the existing protected key, exact model selection, spend caps, and usage receipts.
- No profile silently grants authority. Repository roots, filesystem mode, network mode, and approval behavior are visible and persisted.
- Destructive or externally mutating provider/tool calls require the selected profile's approval policy and a durable decision record.
- Existing active chats continue while the user navigates elsewhere; restart marks in-flight work truthfully and retained provider sessions can resume only after durable rebinding.
- Preserve macOS paths and behavior through source/configuration verification on Windows; do not claim an executed macOS package test.
- Provider cloud task management, vendor billing/admin UI, and exact visual duplication of vendor desktop apps are non-goals. Core local engineering-agent behavior is required.

## Phase 1 — Authority, repository, and durable-session foundation

1. Separate Waypoint's private data root from an explicitly selected execution root and allow a workspace to select, change, or clear a real local repository/folder through a native directory picker.
2. Replace legacy profile implications with explicit Chat/read-only, Developer/workspace-write-with-approval, and Full agent/workspace-write-and-network profiles. Validate roots canonically and fail closed on stale/deleted paths.
3. Persist provider-session bindings per chat/provider/root/profile, pending approval/question records, decisions, and structured provider event metadata. Migrate, back up, restore, reconcile, and delete them safely.
4. Add preload/main IPC contracts and renderer state for repository identity, permission mode, session status, pending decisions, and restart-safe cancellation.

Acceptance: migrations and backup/restore tests pass; path traversal/symlink/root-change tests fail closed; a real workspace can select a repository without moving private Waypoint data; profile/session state survives restart; unrelated workspace data remains untouched.

## Phase 2 — Codex rich-client integration

1. Replace `codex exec --ephemeral --sandbox read-only` with the official local `codex app-server` stdio protocol, version-matched generated schemas, handshake, thread start/resume, turn start/steer/interrupt, and clean shutdown.
2. Map Waypoint profiles to Codex `approvalPolicy` and sandbox policies, including exact writable roots and network behavior.
3. Surface command, file-change, network, permission, MCP elicitation, and user-question requests in Waypoint; return scoped decisions and persist auditable receipts.
4. Stream agent messages, plans, reasoning summaries, command output, file diffs, MCP calls, skills, subagents, warnings, failures, usage, and cancellation into the existing collapsed execution UI.
5. Discover and invoke installed Codex skills/MCP configuration without copying credentials or mutating configuration implicitly.

Acceptance: unit/protocol tests cover handshake, resume, approvals, decline, cancel, timeout, malformed output, crash/restart, and root enforcement; a real signed-in Codex run reads and edits a disposable repository only after the configured approval path; a second message resumes the same provider thread; cancel terminates the active turn.

## Phase 3 — Claude rich-client integration

1. Replace `--tools '' --permission-mode dontAsk --no-session-persistence` with the Claude Agent SDK/CLI runtime using the local signed-in subscription, full default Claude Code context, persistent session resume, and exact working directory.
2. Map Waypoint profiles to Claude permission modes/rules without bypassing protected paths. Surface `canUseTool` and `AskUserQuestion` through the same durable Waypoint decision UI.
3. Stream text, tool calls/results, subagents, skills/plugins/MCP activity, model/session metadata, failures, and cancellation into the shared execution event model.
4. Discover and explicitly invoke local Claude skills, including project skills, while retaining Claude's normal plugin/MCP/CLAUDE.md discovery.

Acceptance: adapter tests cover subscription auth status, resume, approval/decline/question answers, tools, skill invocation, images, cancel, timeout, malformed events, and missing SDK/CLI; a real signed-in Claude run edits a disposable repository through the selected profile and resumes on the next chat message.

## Phase 4 — OpenRouter agent loop, unified UX, automation, and release gates

1. Add a bounded OpenRouter tool-call loop using the existing Waypoint Tool Gateway for repository reads/writes/search, terminal/local CLI, controlled browser/web, and Waypoint domain commands. Enforce the same roots, approvals, cancellation, output budgets, spending reservations, and receipts.
2. Unify provider/session/profile/repository controls in the composer and Settings. Show truthful provider capability differences, pending approvals/questions, session reset, diffs, and collapsed expandable tool chains without interrupting active work during navigation.
3. Add first-class automation actions for provider skill invocation and structured defaults/questions. A webhook may invoke an exact Claude slash skill or Codex skill only after the automation proposal binds provider, model, root, profile, skill identifier, event filters, delivery, duration, and approval digest.
4. Prove the target Azure DevOps PR-created scenario through a disposable/no-external-mutation dry setup plus validation of the exact provisioning proposal. Do not create a real provider webhook without a separately reviewed target and explicit final approval.
5. Run dependency integrity checks for the new SDK, full build/lint/tests, migration/backup/runtime/package gates, Windows packaged-app acceptance for both signed-in CLIs and OpenRouter where configured, and static macOS preservation checks.

Acceptance: OpenRouter can complete a multi-step disposable-repository task through the gateway with durable receipts; provider switching and navigation do not interrupt active runs; the automation proposal can bind and later invoke an exact installed skill; Windows packaged runtime demonstrates repository selection, tools, approvals/questions, session resume, cancellation, and restart truthfully; all serious adversarial findings are fixed.

## Phase 5 — Provider-native run length and visible assistant output

1. Remove every Waypoint-imposed completion-token, provider-output, and wall-clock limit from interactive and automated Codex, Claude, and OpenRouter AI runs. Provider-owned service/context limits and explicit user cancellation remain truthful terminal conditions.
2. Keep security and resource boundaries that are not AI token/time limits: canonical repository authority, approvals, attachment/input validation, protected spending controls, redaction, and explicit Stop/Cancel.
3. Render provider-authored assistant text as the visible chat response while it streams, with the structured tool/reasoning/diagnostic trace collapsed separately. Persist useful partial assistant text when a run fails or is canceled instead of hiding it inside the trace.
4. Add deterministic regressions proving an interactive/native provider run survives the former 120-second and output-byte boundaries, OpenRouter requests do not send a Waypoint completion-token cap, explicit cancellation still works, and partial output remains visible/durable on non-success terminal states.
5. Rebuild, package, reinstall, and exercise the real Windows app with both installed subscription CLIs. Preserve provider-owned and macOS-specific behavior without claiming an unexecuted Mac runtime test.

Acceptance: no normal or automated AI run can become `timed_out` or output-limited because of a Waypoint execution budget; no OpenRouter request includes a Waypoint completion-token cap; Cancel/Stop still terminates work safely; user-facing response text is outside the collapsed execution trace during streaming and after a non-success terminal result; focused/full tests, lint, build, package closure, installed Windows runtime, and fresh adversarial review are clean.

## Phase 6 — Trusted bypass authority and transcript-derived repair

1. Add a fourth, explicit **Bypass permissions** profile for users who intentionally want provider-native engineering autonomy without per-operation prompts. Persist the selection, display an unmistakable warning/confirmation before first use, map it to Codex and Claude native bypass modes, and retain durable execution/tool audit records plus explicit Stop/Cancel.
2. Make approved Claude shell and PowerShell execution actually work on Windows when Anthropic's optional sandbox feature is unavailable. Developer/Full continue to require Waypoint decisions; Bypass runs without prompts. Preserve sandboxed behavior on supported platforms and never misrepresent Windows containment.
3. Replace post-hoc fenced automation proposal parsing as the only creation path with an in-run, schema-validating Waypoint automation proposal tool available to native Claude and Codex. Invalid definitions must return actionable validation errors to the provider so it can correct them before claiming success; successful proposals remain pending user confirmation before external provisioning.
4. Validate exact Claude skill/command discovery before claiming a newly created skill is installed or binding it to an automation. Surface a truthful refresh/new-session requirement where the provider cannot discover files created after initialization.
5. Make automation failure copy precise: failure to prepare an automation must not claim earlier repository changes did not occur. Improve large approval presentation so file path/effect is readable without dumping the entire new file into the primary card.
6. Eliminate competing Windows installation targets for normal releases and repair the current pinned-launch path. The packaged app, Start Menu shortcut, and taskbar launch must resolve to the same current executable; upgrades must not silently leave an older runnable copy as the user's pinned target.
7. Rebuild, reinstall, and exercise the exact newest-chat scenario in the real packaged Windows UI, including bypass selection/confirmation, PowerShell, skill discovery truth, automation validation/correction, navigation persistence, cancellation, and restart. Run fresh adversarial phase and whole-project reviews.

Acceptance: selecting Bypass is explicit and durable, produces no provider operation prompts, and remains cancelable/audited; Developer and Full can execute approved PowerShell on Windows; an invalid automation proposal is corrected in-run or reported as unapplied without contradicting prior file changes; automation cannot bind a nonexistent/undiscovered exact skill; only one current packaged Waypoint executable is presented by Windows shortcuts/pins; focused/full tests, lint, build, Windows packaging/runtime, and fresh adversarial review are clean.

## Review and completion gates

- Each phase receives a fresh read-only adversarial review after its complete build/runtime gate; valid BLOCKER or MAJOR findings are fixed and re-reviewed before advancing.
- After all phases, run the full repository gate and two independent whole-project adversarial reviews concurrently.
- Completion requires no unresolved BLOCKER/MAJOR findings and no manufactured success for unavailable provider/account features.
