# Build to Complete State: Automation Agent Runtime Repair

- Source: `D:\Repos\Waypoint\.codex\build-to-complete\automation-agent-runtime-repair.plan.md`
- Repository: `D:\Repos\Waypoint`
- Branch: `main`
- Started: `2026-08-13T13:53:21.4813474-04:00`
- Updated: `2026-08-13T16:50:00-04:00`
- Baseline worktree: DIRTY — 87 pre-existing entries, including the active provider-parity/recovery implementation and the execution-profile display hardening completed immediately before this plan. Exact normalized `git status --short` SHA-256: `9c25195814afdd49f8d9be704ea23aa590f631974f5f3ae6850255a8b6cefcd5`. All baseline changes are user-owned and must be preserved.
- Current phase: 3 of 3
- Overall status: IN_PROGRESS
- Build status: PASSING
- Confidence: HIGH

## Phase ledger

### Phase 1 — Windows CLI and Claude MCP continuity

- Status: CLEAN
- Tasks: 2/2
- Fix cycles: 2/4
- Review cycles: 5
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

##### Task 1.1 — Safe installed CLI invocation

- Outcome: installed Azure CLI discovery works from the Tool Gateway without a shell or `spawn EINVAL`.
- Non-goals: no real provider mutation.
- Files/subsystems: `electron/core/tool-gateway.ts`, connector provisioning, focused tests.
- Artifacts: safe invocation receipt and stable-ID discovery evidence.
- Integration path: Claude native automation proposal -> `prepareAutomationProposal` -> Tool Gateway `local_cli.run` -> installed Azure CLI.
- Automated proof: shim-resolution tests, Tool Gateway tests, connector tests.
- Runtime proof: actual installed `az` read-only command through Tool Gateway.
- Visual/manual proof: none.
- Decisions/external inputs: existing Azure CLI authentication may be unavailable; report it truthfully if so.

##### Task 1.2 — Reattach Waypoint MCP on resumed Claude sessions

- Outcome: resumed Claude context retains a connected Waypoint native automation tool before the user prompt is released.
- Non-goals: no replacement of user/plugin MCP servers.
- Files/subsystems: `electron/core/claude-agent-sdk.ts`, provider session lifecycle, focused tests.
- Artifacts: fresh/resumed MCP inventory events and successful native tool call.
- Integration path: renderer send -> main run IPC -> resumed Claude Agent SDK query -> dynamic MCP registration -> native proposal callback.
- Automated proof: query lifecycle tests with a resumed session and failed reattachment case.
- Runtime proof: disposable two-turn signed-in Claude session.
- Visual/manual proof: execution diagnostics show Waypoint connected.
- Decisions/external inputs: none.

#### Task evidence

- [x] Task 1.1 — DONE
  - Evidence: `localCliProcessInvocation` verifies the Microsoft `az.cmd` layout and launches adjacent `python.exe -IBm azure.cli` without a shell; focused Tool Gateway suite passed 21/21. Live Tool Gateway execution returned Azure DevOps project `SCV2`, ID `2ab2ac59-3986-4768-bb07-2f18368a1649`, with a completed receipt and no `spawn EINVAL`.
- [x] Task 1.2 — DONE
  - Evidence: resumed queries gate the user prompt, call `setMcpServers`, reload skills, and require connected Waypoint status. Focused Claude suite passed 19/19. Real signed-in Claude 2.1.221 two-turn proof preserved session context marker `violet-orbit`, emitted `claude.mcp.reattached`, and called the native automation tool exactly once.

#### Review log

- Review 1: ISSUES_FOUND — 1 BLOCKER, 0 MAJOR, 1 MINOR.
- Finding: BLOCKER — Bypass mode shadows `canUseTool`, so repository/profile invariants were not enforced in the exact live mode.
  - Disposition: VALID.
  - Reason: real SDK emitted `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`; source confirmed Bypass auto-approved before the callback.
  - Fix/evidence: invariant enforcement and Bypass question routing moved into `PreToolUse`; focused suite passes 20/20. Real signed-in three-turn Claude proof retained one session, reattached MCP, called the native tool, denied an absolute outside-root Write, and left the file absent.
- Finding: MINOR — live proof did not compare provider session IDs.
  - Disposition: VALID.
  - Fix/evidence: proof now records every callback ID and fails unless the unique set contains exactly one ID; live proof passed.
- Review 2: ISSUES_FOUND — 1 BLOCKER, 1 MAJOR, 0 MINOR.
- Finding: BLOCKER — Bypass shell commands can access the host outside the repository on Windows.
  - Disposition: REQUIREMENT CLARIFIED; NOT A DEFECT.
  - Reason: the user explicitly requires Bypass/YOLO to match direct Claude and Codex. The Windows UI already warns that this mode can affect files, processes, accounts, and external systems beyond the selected repository. The plan now records the truthful contract: normal profiles are repository-scoped; Bypass uses the repository as cwd/session identity but deliberately retains host authority.
  - Evidence: focused suites pass 42/42; real signed-in Claude three-turn proof used Bash/PowerShell under Bypass to create one disposable outside-root temp file, preserved the exact provider session and MCP continuity, then removed the file.
- Finding: MAJOR — resumed Claude initialization accepted a replacement provider session ID and rebound history silently.
  - Disposition: VALID.
  - Fix/evidence: resumed initialization now requires the exact durable provider session ID before the prompt is released; mismatch fails closed and does not call `onSession`. Regression test added. Live proof reports `sameSession: true` across all three turns.
- Review 3: ISSUES_FOUND — 0 BLOCKER, 2 MAJOR, 0 MINOR.
- Finding: MAJOR — streamed resume identity validation occurred after prompt release and later messages could rebind the session.
  - Disposition: VALID.
  - Fix/evidence: Waypoint now verifies durable `getSessionInfo` identity/root before launching, installs a `UserPromptSubmit` hook that blocks and suppresses the original prompt on session/root drift before model processing, and rejects every later message with a different session ID. Focused lifecycle suite passes 24/24; real signed-in three-turn proof reports `sameSession: true`.
- Finding: MAJOR — a fresh automation-capable Claude run did not explicitly verify Waypoint MCP connected before releasing the prompt.
  - Disposition: VALID.
  - Fix/evidence: both fresh and resumed automation-capable queries now call `setMcpServers`, reload skills, require `waypoint: connected`, and emit a distinct pre-prompt diagnostic. Fresh-connect, failed-connect-without-yield, and resumed-connect regressions pass.
- Review 4: ISSUES_FOUND — 1 BLOCKER, 0 MAJOR, 1 MINOR.
  - BLOCKER disposition: REQUIREMENT CLARIFIED. Windows approved native shell cannot be repository/network sandboxed without disabling the full provider. Product contract/UI/help now state structured tools retain scope; Developer/Full Agent shell is host authority with approval; Bypass is host authority without prompts.
  - MINOR disposition: VALID. Azure shim file size is checked before its bounded read; oversized shim regression passes.
- Review 5: ISSUES_FOUND — 0 BLOCKER, 3 MAJOR, 1 MINOR during iterative gate.
  - Structured Write/Edit under Bypass now retain selected-root enforcement; only native Bash is exempt under the explicit host-authority contract.
  - Composer/settings predicates now use the actual `terminal` capability, so Windows host-authority warnings are visible for Developer, Full Agent, and Bypass.
  - Subscription provenance and refreshed exact-skill inventory are now validated before prompt release; no-yield regressions added.
  - Ordinary one-off PR review no longer triggers the automation-planning authority reduction; explicit webhook/automation/trigger wording and event-pattern intent do.
  - Live proof cleanup is deferred/retried and cannot mask the runtime verdict on a transient Windows directory lock.
- Review 6: CLEAN — fresh adversarial review found no remaining BLOCKER, MAJOR, or MINOR. Eight focused files / 97 tests, build, lint, live installed Azure discovery, and a real signed-in three-turn Claude resume/MCP/native-tool proof passed.

### Phase 2 — Complete Waypoint receiver and proposal transaction

- Status: CLEAN
- Tasks: 3/3
- Fix cycles: 2/4
- Review cycles: 5
- User checkpoint: NOT_REQUIRED

#### Task evidence

- [x] Task 2.1 — DONE
  - Evidence: provider protocol now requires a two-sided explanation and directs Claude/Codex to the native user-question tool when receiver setup is missing. Deterministic summary names the Waypoint channel/endpoint, protected signing-secret boundary, provider hook/target, AI route, reconciliation, and rollback.
- [x] Task 2.2 — DONE
  - Evidence: `prepareAutomationProposal` plans and validates receiver reachability before Azure/GitHub discovery or approval creation. The store independently rejects `not_configured`, local-network cloud connectors, and unsupported signing-secret imports. Configured-relay Azure fake traverses proposed -> approved -> provisioning checkpoint -> applied and enables the exact skill rule; provider fake reconciles stable target IDs and the exact endpoint.
- [x] Task 2.3 — DONE
  - Evidence: composer submission uses the controlled selected profile ID and execution history displays immutable profile/model; focused presentation regression remains passing.
- Focused Phase 2 suites: 5 files / 30 tests passing; combined core automation/store suite 6 files / 63 tests passing; build and lint passing.

#### Review log

- Review 1: ISSUES_FOUND — 1 BLOCKER, 3 MAJOR, 0 MINOR.
- Finding: BLOCKER — Bypass automation-planning chat could directly mutate providers before proposal approval.
  - Disposition: VALID.
  - Fix/evidence: explicit automation-planning mode now keeps local structured file tools for skill creation while disabling direct Bash, network, external MCP, and Codex live web access. Codex uses workspace-write/no-network instead of danger-full-access for this planning turn. Provider provisioning remains solely behind the approved Waypoint transaction.
- Finding: MAJOR — receiver prerequisite question was advisory.
  - Disposition: VALID.
  - Fix/evidence: native Codex/Claude proposal handlers now convert the typed prerequisite into a durable Waypoint user question with Configure receiver/Stop choices.
- Finding: MAJOR — configured-relay proof fabricated the stack in store calls.
  - Disposition: VALID.
  - Fix/evidence: production-stack integration now uses `DesktopSyncService.planWebhookChannel/createWebhookChannel/webhookProvisioningSecret`, OS-protected vault storage, actual `provisionConnector` stable-ID reconciliation, store approval/checkpoints, and applied exact rule with fake relay/provider transports and no external writes.
- Finding: MAJOR — `maxDurationMs` could be digest-bound but was ignored by provider-native runtime.
  - Disposition: VALID.
  - Fix/evidence: proposal creation rejects any new action duration limit with an explicit provider-native/no-Waypoint-limits error; runtime and durable authority now agree.
- Review 2: ISSUES_FOUND — prompt-keyword intent detection could both miss automation requests and reduce ordinary PR-review authority; Codex planning did not prove configured MCP was absent; Claude did not reload skills immediately before same-turn proposal validation.
  - Disposition: VALID.
  - Fix/evidence: prompt wording no longer controls authority. The composer now has an explicit **Automate** mode sent as a strict boolean IPC value. Only that user-selected mode exposes the proposal protocol and reduced authority. Codex launches with `mcp_servers={}`, disables network/web, and synchronously fails before prompt release if any MCP remains. Claude reloads skills immediately before validating the exact proposed skill. Focused 63 tests, build, and lint pass.
- Review 3: ISSUES_FOUND — Automate could steer into an already-running unrestricted Codex turn, and OpenRouter still received the automation protocol without a supported explicit mode.
  - Disposition: VALID.
  - Fix/evidence: active Codex turn identity now includes Automate mode and steering requires an exact profile/model/mode match. OpenRouter no longer receives or parses the automation proposal protocol; Automate is explicitly available for the local-subscription Codex/Claude paths in this phase.
- Review 4: CLEAN — fresh adversarial re-review found no remaining BLOCKER, MAJOR, or MINOR after the exact composer-mode, Codex MCP isolation, same-turn Claude skill refresh, steering, and provider-surface repairs.

### Phase 3 — Windows packaged acceptance and final gates

- Status: REVIEWING
- Tasks: 1/1
- Fix cycles: 4/4
- Review cycles: 4
- User checkpoint: REQUIRED

#### Task evidence

- [x] Task 3.1 — DONE
  - Automated gates: full suite 151 files / 734 tests PASS; production build PASS; lint PASS; package runtime closure PASS with first playable Fast Local audio at 364 ms after readiness; dependency verification PASS with 0 vulnerabilities, 644 verified signatures, 134 attestations, 715 packages with no Git/URL dependencies, and live OSV PASS.
  - Runtime gates: installed Azure CLI read-only SCV2 discovery PASS; real signed-in Claude 2.1.221 resumed-session proof PASS with one durable provider session, Waypoint MCP reattached before prompt release, one native call, and truthful Windows Bypass host authority.
  - Package: `D:\Repos\Waypoint\release\Waypoint-0.0.0-win-x64.exe`, SHA-256 `AFEDBA4564399939D6FE55462144EE1602178A294BD50370848E9F6EB581FAD6`; silent elevated install exit code 0; installed executable `C:\Program Files\Waypoint\Waypoint.exe` version 0.0.0 launched through the normal installed path.
  - Installed visual acceptance: dark UI is readable; Codex and Claude are available from user-installed CLIs; OpenRouter is truthfully unavailable without a key; immutable Bypass/model history is visible; explicit **Automate** mode is visible and explains the approval-gated authority boundary.
  - Installed real-user workflow: a disposable Claude Automate chat described the Waypoint receiver, protected signing-secret boundary, provider hook/target, uncapped provider-native route, verification, and rollback. It stopped at a durable **Waypoint receiver required** question, accepted **Stop**, then rendered Claude's follow-up native question without duplicating the durable request. The second **Stop here** answer completed normally with immutable `Bypass permissions · no prompts · claude-opus-5` history and explicit `Nothing was provisioned, enabled, or created.` No receiver, provider hook, confirmation card, or external resource was created.

#### Review log

- Review 1: ISSUES_FOUND — 0 BLOCKER, 2 MAJOR, 0 MINOR.
- Finding: MAJOR — Claude `AskUserQuestion` could be reported through both `canUseTool` and `PreToolUse`, inserting the same execution/provider request twice and failing with a SQLite UNIQUE constraint.
  - Disposition: VALID; reproduced in the installed app after the first receiver answer.
  - Fix/evidence: `ProviderDecisionGate` deduplicates concurrent provider callbacks and replays one durable answer through terminal completion; the store independently makes an identical duplicate idempotent and rejects payload drift. Focused 38 tests and full 734-test suite pass. Installed replay rendered and resolved both question stages without a constraint/infrastructure error.
- Finding: MAJOR — a Windows npm-shim Claude launch could resolve a native Node executable during discovery but later ask the SDK to spawn literal `node` from a sparse Explorer/taskbar PATH.
  - Disposition: VALID.
  - Fix/evidence: the SDK environment now derives its child PATH from the exact discovered Claude executable and the same bounded Windows search roots; sparse-PATH npm-shim regression passes.
- Additional gate repair: the packaged Fast Local check exposed repeated 1.2–1.3 second cold model loads because the production process adapter discarded readiness and spawned a new model process per segment. The verified worker now remains warm and is reused across segments; package-runtime closure measures the production after-readiness path at 364 ms without relaxing the 1.1-second threshold.
- Review 2: ISSUES_FOUND — Claude model text/reasoning/result events could persist secrets; chat deletion canceled only the legacy registry; resumed Codex accepted a replacement thread ID; managed workspace startup cleanup omitted derived roots.
  - Disposition: VALID. Claude events now use the established redaction layer; deletion cancels and awaits all native/legacy providers before removing the owner and fails closed if no registry owns an active run; Codex requires exact resume identity without rebinding; startup cleanup derives every workspace execution root. Regressions pass.
- Review 3: ISSUES_FOUND — Codex Automate could inherit direct Windows shell authority and configured/app-injected MCP tools while claiming those operations were disabled.
  - Disposition: VALID. Automate now starts a fresh Codex thread under a reduced child process, disables shell/apps/plugins/browser/computer/image features, removes app-injected tool environment, creates one exact inline-table override disabling every configured MCP, uses `untrusted` command policy, declines direct privileged requests, permits only root-scoped file changes, and retains the native Waypoint proposal tool. Unknown tool-bearing MCP status fails closed before prompt release.
  - Evidence: real signed-in subscription proof passed for Claude and Codex; each called the native proposal tool once and created only a validated pending definition. A separate live Codex fresh+exact-resume proof completed without session rebind.
- Review 4: ISSUES_FOUND — canonical Windows profile routing was not forced before initialization; generic manual senders could be labeled applied; and Codex advertised the Automate tool in ordinary chats.
  - Disposition: VALID. Windows now sets canonical `%USERPROFILE%\AppData\Roaming\waypoint` before the single-instance lock and any store/vault initialization, independent of inherited `APPDATA`. Generic senders fail without creating/enabling a rule until manual receiver/secret setup is verified, with a second fail-closed guard in the connector layer. Codex registers `waypoint_automation_proposal` only for explicit Automate turns. Focused regressions pass.
- Review 5: ISSUES_FOUND — Codex Windows cancellation could leave command descendants alive; high-confidence bare provider tokens could enter durable events; and legacy install cleanup trusted only a same-named directory before deletion.
  - Disposition: VALID. Codex cancellation now awaits Windows `taskkill /PID /T /F` (or a detached POSIX process-group signal) before completion, including a real Windows descendant regression. Durable provider/tool redaction recognizes high-confidence GitHub, GitLab, OpenAI/Anthropic, Stripe, Slack, npm, and JWT credential formats, including direct Claude/Codex durable-event regressions. Legacy cleanup now requires exact package markers and only moves an authenticated legacy tree to a recoverable quarantine; it never recursively deletes it, and unrelated same-named directories remain untouched.
- Review 6: ISSUES_FOUND — documented Slack rotating-refresh and GitLab credential prefix families were not yet covered by high-confidence bare-token redaction.
  - Disposition: VALID. Redaction now covers Slack `xoxe` plus the documented GitLab `glpat`, `gldt`, `glrt`, `glrtr`, `glcbt`, `gloas`, `glptt`, `glagent`, and `glsoat` families, with direct and durable Claude/Codex event regressions.
- Review 7: ISSUES_FOUND — the explicit GitLab prefix list still omitted other documented formats and the `_gitlab_session` cookie.
  - Disposition: VALID. The matcher now covers the high-confidence GitLab `gl<type>-` namespace as a class with a conservative suffix length, and labeled/JSON assignment redaction covers `_gitlab_session`. Direct and durable Claude/Codex regressions include `glft`, `glimt`, `glwt`, `glffct`, and session-cookie examples.
- Final source/release gates after Review 7: full suite 153 files / 760 tests PASS; build, lint, and diff-check PASS; package runtime closure PASS at 340.81 ms after readiness; dependency gate remains PASS with 0 vulnerabilities, 644 registry signatures, 134 attestations, 715 registry packages, and live OSV clean. Real signed-in Claude/Codex Automate proof PASS with two native proposal calls and no external provisioning. Final installer SHA-256: `11E66774E6905C5B2F5BEBCA12283AD973565AA34BA8CC1EC3859977F10079EC`; release ASAR SHA-256: `B7FB66FD410DD215663834E8437F69AE29FC4C2E876B0FC06901A74BBDD7371C` (unsigned development build).

## Deferred MINOR findings

- None.

## Blockers

- Final installed-copy acceptance is blocked on Windows elevation: the rebuilt unsigned development installer was presented twice and the UAC operation was canceled both times. The release artifact is verified; `C:\Program Files\Waypoint` remains the older build until the user manually runs the current installer and accepts elevation.
