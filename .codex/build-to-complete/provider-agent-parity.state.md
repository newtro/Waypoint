# Build to Complete State: Provider Agent Parity

- Source: D:\Repos\Waypoint\.codex\build-to-complete\provider-agent-parity.plan.md
- Repository: D:\Repos\Waypoint
- Branch: main
- Started: 2026-08-12T20:00:00-04:00
- Updated: 2026-08-13T13:02:00-04:00
- Baseline worktree: clean at 29aa82e532d22df3702a2411a81eeeeac9f7772e
- Current phase: 6 of 6
- Overall status: COMPLETE
- Build status: PASS
- Confidence: HIGH

## Phase ledger

### Phase 6 — Trusted bypass authority and transcript-derived repair

- Status: DONE
- Tasks: 7/7
- Fix cycles: 4/4
- Review cycles: 5
- User checkpoint: REQUIRED

#### Acceptance contracts

- Task 6.1 — Explicit bypass authority
  - Outcome: a confirmed, persisted bypass profile maps to native provider no-prompt modes while retaining audit and cancellation.
  - Non-goals: silently changing existing Chat/Developer/Full authority or weakening canonical root validation for ordinary profiles.
  - Runtime proof: packaged Claude and Codex perform disposable writes/commands without approval cards only after bypass confirmation.
- Task 6.2 — Windows Claude PowerShell
  - Outcome: approved Developer/Full commands run when the optional Anthropic Windows sandbox is unavailable; supported-platform sandbox behavior remains intact.
  - Runtime proof: packaged Full Agent PowerShell completes after approval and Bypass completes without approval.
- Task 6.3 — In-run automation validation
  - Outcome: native providers receive schema errors and can submit corrected pending proposals before reporting success.
  - Runtime proof: replay of the newest SCv2 request creates a valid pending proposal or a precise unapplied result.
- Task 6.4 — Skill discovery truth
  - Outcome: automation binding and assistant claims distinguish provider-discovered skills/commands from files merely written during the current session.
  - Runtime proof: newly created skill is either discovered after provider refresh or reported as pending refresh.
- Task 6.5 — Precise decision UX
  - Outcome: large file approvals emphasize operation/path and collapse payload details; automation-card failure does not contradict completed file writes.
- Task 6.6 — Single Windows install target
  - Outcome: installer and user launch surfaces resolve to one current executable, including the pinned taskbar path.
  - Runtime proof: process executable, Start Menu target, and taskbar target agree after reinstall/restart.
- Task 6.7 — Complete packaged acceptance and reviews
  - Outcome: full gates and fresh adversarial reviews are clean for the transcript-derived flow.

#### Transcript evidence

- Newest durable chat `494145e2-a390-4011-a87a-7ecf632763c8`, execution `f3f22498-65c9-45a8-808e-526d74568211`.
- Full Agent profile emitted `Sandbox disabled` then rejected Bash/PowerShell as policy-blocked before any command approval.
- Claude init inventory did not list `pr-review` or `auto-pr-review`, while the final response claimed the latter was installed.
- The fenced proposal used an invalid trigger/schema and the post-run renderer appended ambiguous `Nothing was changed` copy after six repository file writes/edits had completed.
- Windows process path after taskbar launch was the stale `C:\Program Files\Waypoint\Waypoint.exe` rather than the newly installed current-user build.

#### Current evidence

- Task 6.1 — PASS. Added `Bypass permissions · no prompts`, persisted per workspace/chat/provider, with first-selection danger confirmation, native Codex `danger-full-access`/`never` mapping, native Claude `bypassPermissions` mapping, and retained execution audit/Stop. Live signed-in Claude and Codex each wrote an exact disposable file from a workspace path containing spaces with zero Waypoint approval callbacks; files were removed.
- Task 6.2 — PASS. Removed the blanket Windows Bash denial. Developer/Full still route mutable operations through durable Waypoint decisions, while explicit Bypass uses Claude's native no-prompt mode and truthfully warns that Windows shell commands are not sandbox-contained.
- Task 6.3 — PASS. Claude receives an in-process `mcp__waypoint__automation_proposal` tool and Codex receives `waypoint_automation_proposal`; schema/skill errors remain in-turn, and post-run failure text distinguishes unapplied automation from earlier repository/tool changes.
- Task 6.4 — PASS. Native tools force-refresh and validate exact installed skill/command inventory. Live signed-in Claude in `D:\Mathew Repos\SCV2` discovered `auto-pr-review` and prepared a validated-only pending `/auto-pr-review --event-context` proposal without provider provisioning or repository writes.
- Task 6.5 — PASS. File-change decisions show operation/path/payload size with full JSON collapsed; automation failure copy no longer claims all prior changes were absent.
- Task 6.6 — PASS. Machine-wide NSIS install is canonical. Built and installed executable SHA-256 matched exactly; taskbar and Start Menu shortcuts target `C:\Program Files\Waypoint\Waypoint.exe`; no Local Programs duplicate exists; launching the taskbar shortcut started that exact executable.
- Task 6.7 — PASS. Final full gate: 149 files / 708 tests, lint, production build, diff check, Windows packaging, hosted-CI resource closure, live dependency policy/OSV/signature/attestation gates, signed-in provider proofs, and canonical installed launch. Phase review plus two independent whole-project reviews are CLEAN after correcting real-entry bypass budgeting, cross-provider skill proof, malformed/partial OpenRouter spend reconciliation, hosted tool-loop bounds, and safe legacy-install migration. The target Fast Local cold-start gate remains a truthful deferred MINOR at 1131.7 ms versus 1100 ms; four CPU threads improved it without weakening the target.

#### Final installed acceptance

- Final packaged and installed executable SHA-256: `3373E08BF6003C2366CBFFF444B5AF4E2E32994A193D64010C2C93052781B7C4`.
- Taskbar and Start Menu both target `C:\Program Files\Waypoint\Waypoint.exe`; no `%LOCALAPPDATA%\Programs\Waypoint\Waypoint.exe` duplicate exists.
- Launching the taskbar shortcut started PID `60056` from the exact Program Files executable and left Waypoint open.
- Legacy per-user migration never executes a user-writable uninstaller while elevated. The installer removes only legacy HKCU registration/links; the next unelevated packaged launch removes only the canonical Local Programs binary directory after realpath/reparse validation, preserving Roaming workspace/profile data.

### Phase 5 — Provider-native run length and visible assistant output

- Status: DONE
- Tasks: 5/5
- Fix cycles: 0/4
- Review cycles: 0
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

- Task 5.1 — Unbounded provider execution
  - Outcome: Codex, Claude, and OpenRouter AI runs have no Waypoint token/output or elapsed-time termination condition.
  - Non-goals: Removing provider-owned limits, explicit cancellation, authority policy, attachment/input validation, redaction, or protected spending controls.
  - Files/subsystems: execution receipts, native adapters, OpenRouter transports/agent loop, automation runtime.
  - Automated proof: former timeout/output/token-cap regressions and explicit-cancel regressions.
  - Runtime proof: installed signed-in providers continue beyond the old boundary or complete naturally without a Waypoint deadline.
- Task 5.2 — Visible assistant response
  - Outcome: Provider-authored response text renders in the conversation while structured activity remains collapsed.
  - Non-goals: Exposing hidden reasoning or promoting tool output into assistant prose.
  - Files/subsystems: execution event canonicalization, terminal persistence, renderer execution history, theme.
  - Automated proof: canonical streaming/final de-duplication and partial terminal message persistence tests.
  - Runtime proof: installed UI visibly separates assistant prose from expanded tool/diagnostic details.
- Task 5.3 — Truthful UX and documentation
  - Outcome: UI/help no longer claims interactive AI duration/output budgets or advises choosing a longer profile.
  - Non-goals: Removing truthful bounded labels from unrelated capture, document, browser, or tool payloads.
  - Automated proof: presentation/help regressions and source assertions.
  - Runtime proof: terminal status and retry/cancel copy match actual provider lifecycle.
- Task 5.4 — Build and package verification
  - Outcome: full repository and Windows package gates pass with runtime closure intact.
  - Automated proof: test, lint, build, package/runtime closure, diff check.
  - Runtime proof: packaged app starts and both CLIs are discovered from user installation.
- Task 5.5 — Fresh adversarial acceptance
  - Outcome: no BLOCKER/MAJOR remains in provider lifecycle, cancellation, persistence, or response presentation.
  - Automated proof: focused reruns after every valid finding.
  - Runtime proof: fresh-context reviewer checks the installed and source integration paths.

#### Final evidence

- Native Codex/Claude execution has no Waypoint duration, token, or assistant-output cap; remote agent leases support no-deadline jobs; cancellation remains explicit and process-tree-aware.
- Claude/Codex partial and final assistant prose is canonicalized separately from bounded audit details. OpenRouter uses streaming SSE and a durable assistant draft that remains visible on failure/cancel and becomes the canonical message on success.
- OpenRouter sends no Waypoint completion-token cap or false `max_price`. Month/YTD reservations block new work; authoritative provider costs are recorded. A paid terminal answer that exceeds its reservation is preserved with an over-cap receipt and blocks later routing, while an over-cap tool turn is stopped before executing the requested tool.
- Phase 5 review findings covering remote deadlines/truncation, Claude delta aggregation, OpenRouter streaming/non-success persistence, Codex prose truncation, and false price controls were corrected and locked by regressions.

### Phase 1 — Authority, repository, and durable-session foundation

- Status: DONE
- Tasks: 4/4
- Fix cycles: 2/4
- Review cycles: 3
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

- Task 1.1 — Execution root selection
  - Outcome: Native selection persists a canonical repository root separately from private Waypoint storage.
  - Non-goals: Moving or exposing Waypoint private data.
  - Files/subsystems: store schema, workspace IPC, preload, Settings/composer.
  - Artifacts: migration, root APIs, picker UI, tests.
  - Integration path: workspace UI -> native dialog -> main validation -> store -> execution profile.
  - Automated proof: migration, traversal, symlink, missing-root, workspace isolation tests.
  - Runtime proof: select and display a disposable real repository.
  - Visual/manual proof: selected root and authority are clear in composer/Settings.
  - Decisions/external inputs: None.
- Task 1.2 — Explicit authority profiles
  - Outcome: Chat, Developer, and Full agent profiles map to explicit filesystem/network/approval policy.
  - Non-goals: Silent full-host access or credential injection.
  - Files/subsystems: policy types, store defaults/migration, gateway mapping, UI.
  - Artifacts: validated profiles and presentation.
  - Integration path: composer profile -> durable execution receipt -> provider policy.
  - Automated proof: policy digest, canonical roots, root-change, and authority tests.
  - Runtime proof: read-only and write-capable disposable runs behave differently.
  - Visual/manual proof: authority summary is visible before send.
  - Decisions/external inputs: None.
- Task 1.3 — Provider session and decision persistence
  - Outcome: Per-chat provider bindings plus pending/answered decisions survive restart and reconcile truthfully.
  - Non-goals: Persisting CLI credentials.
  - Files/subsystems: schema/migrations, backup/restore, execution lifecycle.
  - Artifacts: bindings, requests, decisions, structured event metadata.
  - Integration path: provider adapter -> store -> renderer -> response -> adapter.
  - Automated proof: lifecycle, crash/restart, deletion, backup/restore tests.
  - Runtime proof: session state and pending decisions are visible after navigation/restart.
  - Visual/manual proof: pending request card and session status.
  - Decisions/external inputs: None.
- Task 1.4 — IPC and renderer foundation
  - Outcome: Safe root/session/approval APIs and non-interrupting UI state are wired end to end.
  - Non-goals: Provider protocol implementation in this phase.
  - Files/subsystems: main/preload/type declarations/renderer.
  - Artifacts: typed IPC and shared decision components.
  - Integration path: provider event -> main -> renderer card -> main decision.
  - Automated proof: IPC validation and navigation lifecycle tests.
  - Runtime proof: root and placeholder provider session state render in the actual app.
  - Visual/manual proof: no settings drawer regression or active-chat interruption.
  - Decisions/external inputs: None.

#### Task evidence

- [x] Task 1.1 — `workspaces.execution_root`, canonical existing-directory validation, native folder IPC, safe root-change guard, profile-root reconciliation; regression proof in `provider-agent-foundation.test.ts`. Real Windows UI selected and displayed `C:\Users\scott\AppData\Local\Temp\Waypoint-Agent-Root-QA`, then cleared the binding.
- [x] Task 1.2 — Three exact built-in profiles (`Chat · read only`, `Developer · approve changes`, `Full agent · network enabled`), bounded receipts, migration from legacy names, composer summary, and polished Settings cards. Unit proof in `execution-budget.test.ts`, `store.test.ts`, and provider foundation tests.
- [x] Task 1.3 — Durable provider sessions and requests, restart expiry, session invalidation on root change, structured execution-event metadata, backup/restore stale/expired reconciliation, and deletion-safe foreign keys. Proof in provider foundation and backup administration tests.
- [x] Task 1.4 — Typed main/preload/renderer APIs, native picker, non-interrupting Settings tab, provider session/reset UI, pending decision cards, and refreshed product help. Real Electron inspection verified the active chat remained open in its tab while Settings was selected.

#### Gate evidence

- `npm run lint` — PASS, 0 errors/warnings.
- `npm test` — PASS, 140 files / 629 tests after first review fixes; final focused crash-recovery gate 41 tests PASS.
- `npm run build` — PASS, TypeScript/preload/Vite production output.
- Focused foundation suite — PASS, 6 files / 61 tests before full suite.
- Windows Electron runtime — PASS for Settings-tab navigation, authority presentation, native folder picker, persisted root display, clear-root round trip, and chat-tab preservation.

#### Review log

- Review 1: BLOCKER root identity substitution; MAJOR legacy profile normalization; MAJOR provider-request JSON restore validation.
- Fix 1: schema 41 persists root filesystem identity, startup canonical/identity validation invalidates unsafe roots, reserved profiles restore to exact current contracts, and new provider restore fields are bounded and parsed atomically.
- Review 2: MAJOR crash window between invalid-root clearing and session staling.
- Fix 2: atomic root/session recovery plus unconditional session-to-current-authority reconciliation with a direct interrupted-state regression.
- Review 3: CLEAN — no BLOCKER or MAJOR.

### Phase 2 — Codex rich-client integration

- Status: DONE
- Tasks: 5/5
- Fix cycles: 3/4
- Review cycles: 3
- User checkpoint: NOT_REQUIRED

#### Task evidence

- [x] Task 2.1 — Replaced normal Codex chat execution with a version-matched `codex app-server` JSONL/JSON-RPC client, durable thread start/resume, turn start/interrupt, bounded shutdown, malformed-output handling, and a generated 0.146.0 experimental schema snapshot.
- [x] Task 2.2 — Exact profile mapping now starts Chat read-only, Developer read-only with per-write escalation, and Full agent read-only with network enabled and per-write escalation. Roots are canonical/bounded by the foundation and revalidated before process spawn.
- [x] Task 2.3 — Command, file-change, network, permission, MCP elicitation, native user-question, legacy command/patch, and dynamic-tool requests become durable Waypoint provider requests with scoped allow-once/session/decline/cancel responses.
- [x] Task 2.4 — Agent deltas, plans, reasoning summaries, command output, file patches/diffs, MCP calls/progress, collaboration/subagents, warnings, token usage, reroutes, failures, and cancellation map into the collapsed execution timeline.
- [x] Task 2.5 — Codex retains its installed CLI-owned authentication, configuration, skills, plugins, and MCP discovery. Waypoint does not read or copy credentials and supplies the selected repository/runtime root to the provider.

#### Gate evidence

- `npm run lint` — PASS, 0 errors/warnings.
- `npm test` — PASS, 141 files / 640 tests.
- `npm run build` — PASS, TypeScript/preload/Vite production output.
- Protocol suite — PASS, 10 tests covering root rejection, handshake/thread start, resume fallback, allow/decline, cancellation, timeout, malformed JSONL, and premature process exit.
- Real signed-in Codex app-server — PASS, two turns resumed exact thread `019ff7c2-82ce-79d2-8980-cdc70a936c4a` and returned the remembered token.
- Real Electron UI — PASS, two-message persisted session returned `WAYPOINT_UI_CODEX_OK`; Developer write produced a durable approval card and no file before approval; allow-once created exact `APPROVAL_OK`; a later decline created no file. Disposable files were removed.
- Dark-theme approval card — PASS, live computed colors use dark card `rgb(22,35,30)` / light text `rgb(229,238,233)` and dark detail surface `rgb(14,24,20)` / light text `rgb(203,216,209)`; screenshot `codex-approval-dark-theme.png`.

#### Review log

- Pre-review runtime fix: Developer initially inherited workspace-write and created the first disposable file without approval. Remapped all `on-write` profiles to a read-only baseline with provider escalation, added mapping proof, reran the same real UI scenario, and verified both allow and decline paths.
- Review 1: BLOCKER live root replacement and host-wide permission echo; MAJOR native question flattening, schema/version drift, malformed protocol completion, missing MCP/steer/skill affordances.
- Fix 1: Per-turn root identity reconciliation, canonical permission clamping, exact 0.146.0 pin, question/MCP form UI, native steering, structured skill invocation/MCP discovery, and fail-closed terminal/message handling.
- Review 2: BLOCKER junction escape and MCP secret persistence; MAJOR malformed subagent variants and MCP multi-select typing.
- Fix 2: Realpath nearest-ancestor enforcement, pre-persistence elicitation redaction, exact structured-item validation, and schema-shaped array form handling.
- Review 3: one remaining subagent enum/required-field gap; fixed with exact required fields and enum regressions; final re-review CLEAN.

### Phase 3 — Claude rich-client integration

- Status: DONE
- Tasks: 4/4
- Fix cycles: 2/4
- Review cycles: 3
- User checkpoint: NOT_REQUIRED

#### Task evidence

- [x] Task 3.1 — Replaced the tool-disabled Claude wrapper with exact `@anthropic-ai/claude-agent-sdk` 0.3.229 while launching Waypoint's discovered, compatible user-installed Claude Code CLI, using the signed-in local subscription, full default Claude Code tool context, exact cwd, persistent resume, user/project/local settings, plugins, skills, CLAUDE.md, and MCP discovery. The installer excludes the SDK's optional native Claude payload so packaged execution cannot silently diverge from CLI discovery.
- [x] Task 3.2 — Chat exposes only read/search/question tools; Developer and Full expose the Claude Code preset but route writes, commands, network, MCP, and questions through durable Waypoint decisions. Canonical root/junction checks, non-bypassable permission mode, session-only suggestions, and secret redaction are enforced.
- [x] Task 3.3 — Partial text, tool start/result/progress, reasoning, subagents, init/capability inventory, auth, usage, terminal failure, cancellation, and timeout map into the shared execution timeline.
- [x] Task 3.4 — `skills:'all'` plus normal user/project/local discovery retains slash skills and plugins; live init exposed 28 skills, five plugins, and three connected MCP servers.

#### Gate evidence

- Focused SDK/protocol suite — PASS, including persistent resume, profile mapping, write approval/decline, native multi-question answers, canonical junction denial, redaction, rich events, cancel, timeout, and malformed/terminal behavior.
- Full repository suite after implementation — PASS, 144 files / 662 tests; lint/build/diff-check PASS before final Phase 3 tightening.
- Direct signed-in Agent SDK — PASS, write `CLAUDE_LIVE_OK` after approval and exact session resume `6a3bf1ae-2127-48ea-aae5-179b77137356` returned the same token.
- Real Electron IPC/UI runtime — PASS, read-only Claude chat persisted session `a0841f52-a1b7-4430-86ac-8e3562133997`, resumed the same ID, and returned `WAYPOINT_CLAUDE_UI_OK`; Developer write was blocked behind durable command/question/file requests and created the disposable file only after file-change approval.
- Windows limitation surfaced truthfully — Anthropic sandbox reports its Windows feature gate inactive. Waypoint keeps read-only tools structurally absent and forces explicit approval on Developer/Full operations; the provider warning is retained as a diagnostic rather than suppressed.

#### Review log

- Review 1: BLOCKER live-root replacement, unsandboxed Windows Bash escape, provider wildcard session rules, full host environment/API-key leakage; MAJOR Chat MCP/skills escape and malformed terminal success.
- Fix 1: Per-tool persisted-root reconciliation, Windows Bash fail-closed when the native sandbox is inactive, host-owned one-shot/session decisions without provider rules, minimum environment plus signed-in account provenance, profile-gated MCP/skills, and exact init/terminal validation.
- Review 2: BLOCKER valid Claude Team subscription reported `apiKeySource:none` rather than OAuth.
- Fix 2: Validate the SDK account as first-party with a nonempty subscription and no API-key route; accept the truthful init source emitted by the signed-in Team runtime.
- Review 3: CLEAN, including a real signed-in write and exact session resume.

### Phase 4 — OpenRouter agent loop, unified UX, automation, and release gates

- Status: DONE
- Tasks: 5/5
- Fix cycles: 3/4
- Review cycles: 4
- User checkpoint: REQUIRED

#### Task evidence

- [x] Task 4.1 — OpenRouter now performs a bounded 12-turn/32-call agent loop with cumulative spend enforcement and uses typed Tool Gateway repository, terminal/CLI, controlled web/browser, and Waypoint domain tools. Reads are receipt-backed; mutations/external calls require durable decisions.
- [x] Task 4.2 — Existing shared composer authority/session controls, non-interrupting tabs, collapsed timelines, provider decisions/questions, cancellation, and Settings capability states now cover all three routes; help text describes the exact differences.
- [x] Task 4.3 — Automation actions support digest-bound `ai_skill` with exact provider, model, profile/root authority, skill identifier, slash invocation, filter, delivery, duration, and provisioning fields. Triggered runs use the native Codex app-server or Claude Agent SDK and remain cancelable.
- [x] Task 4.4 — A disposable no-network Azure DevOps `git.pullrequest.created` proposal for project/repository `scv2` binds Claude `/auto-pr-review`, remains pending with no channel/rule/run/external mutation, and has deterministic digest proof.
- [x] Task 4.5 — Dependency integrity, full suite, Windows installer/package runtime closure, and packaged Windows acceptance pass. macOS resources remain statically preserved and are checked separately because no Mac is available.

#### Gate evidence

- Focused Phase 4 suite — PASS, 6 files / 32 tests plus the exact Azure DevOps dry-proposal fixture.
- Build — PASS after the OpenRouter loop, schema 42 migration, native automation runtime, and Claude review fixes.
- Phase 3 real signed-in Claude revalidation — PASS, session `fb587234-0d62-43e6-8995-e2c2ca66f531`.
- Phase 4 adversarial re-review — CLEAN after profile-authority, cancellation, exact-skill, CLI-contract, root/provisioning, and stale-rule corrections; focused 8 files / 62 tests PASS.
- Full repository suite — PASS, 147 files / 688 tests; lint/build/diff-check PASS.
- Dependency integrity — PASS: 0 vulnerabilities, 644 verified signatures, 134 attestations, 715 registry packages pass policy plus live OSV/malware checks, and no Git/remote URL dependencies.
- Backup and document workers — PASS: compiled inspect/restore drill with cleanup and compiled native-text ingestion.
- Windows package — PASS: signed NSIS `release/Waypoint-0.0.0-win-x64.exe`; SHA-256 `4F262E8E0EAC3A209965FAA8B2BD3E17F9F5E1C1E1D3C837D51C24C7ADC353F3`; packaged runtime/resource closure PASS; first playable Fast Local audio 1029.7 ms under the 1100 ms Windows target.
- Final independent whole-project reviews — CLEAN after correcting interactive slash prompt composition, exact-operation OpenRouter session grants, runtime-secret progress redaction, awaited Windows process-tree cancellation, and recursive Codex audit redaction.
- Packaged Windows runtime — PASS on Windows NT 10.0.26200.0: normal profile launch, exact app.asar UI, Codex Ready, Claude Ready, OpenRouter truthfully not configured, browser/profile discovery, capture/voice states, dark-theme readability, non-interrupting Settings tab, and exact window position/size/theme/tab persistence across restart.
- macOS package execution — UNAVAILABLE on this Windows host (`electron-builder` correctly requires macOS); cross-platform voice/browser assets and Darwin Claude SDK dependencies are present, while actual macOS runtime remains an external gate.

## Deferred MINOR findings

- None.

## Blockers

- None.
