# Build to Complete State: Windows Packaged Acceptance and Repair

- Source: D:\Repos\Waypoint\.codex\build-to-complete\windows-packaged-acceptance.plan.md
- Repository: D:\Repos\Waypoint
- Branch: main
- Started: 2026-08-06T21:18:07.3203743-04:00
- Updated: 2026-08-06T23:18:13.7943466-04:00
- Baseline worktree: clean; main matched origin/main at aa2a419
- Current phase: 3 of 3
- Overall status: COMPLETE_WITH_FINDINGS
- Build status: PASS_WITH_INTERMITTENT_VOICE_SLA_FAILURE
- Confidence: HIGH

## Phase ledger

### Phase 1 — Repair blocking Windows runtime defects

- Status: DONE
- Tasks: 2/2
- Fix cycles: 1/4
- Review cycles: 2
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

##### Task 1.1 — Windows npm-shim CLI probing

- Outcome: An installed compatible Codex npm CLI is detected and executable on Windows; native executable and macOS/Linux probing remain shell-free and unchanged.
- Non-goals: Installing CLIs, changing authentication, enabling provider fallback, or broadening shell/tool authority.
- Files/subsystems: `spikes/cli-capabilities.ts`, focused tests.
- Artifacts: Production resolver/runner and regression tests.
- Integration path: Electron `waypoint:cli-capabilities` -> `detectCli` -> exact resolved CLI -> provider routing/UI.
- Automated proof: Focused tests, live CLI verification, full test/build/lint.
- Runtime proof: Fresh packaged UI lists Codex as available and can complete a chat turn.
- Visual/manual proof: Provider selector and route/status evidence in packaged app.
- Decisions/external inputs: Existing signed-in Codex CLI is available locally.

##### Task 1.2 — Fresh-workspace autonomous profile initialization

- Outcome: A workspace created during the current process immediately contains both required default profiles and can use gateway-dependent features without a restart crash.
- Non-goals: Changing profile authority, permissions, roots, or migration semantics.
- Files/subsystems: `electron/core/store.ts`, focused tests.
- Artifacts: Workspace creation integration and regression test.
- Integration path: onboarding/create workspace -> store transaction -> profile initialization -> gateway policy.
- Automated proof: Store tests plus full suite/build/lint.
- Runtime proof: Create workspace, use chat/tool surfaces, restart packaged app successfully.
- Visual/manual proof: No main-process error; workspace and chat reopen.
- Decisions/external inputs: None.

#### Task evidence

- [x] Task 1.1 — DONE
  - Evidence: Shell-free native Node execution of npm package entrypoints passed adversarial real-process coverage for spaces and command metacharacters. Live Codex and Claude each completed with `WAYPOINT_LIVE_OK`; cancellation returned `canceled`; invalid model returned a real failed result.
- [x] Task 1.2 — DONE
  - Evidence: New workspaces initialize both named profiles transactionally; legacy archives backfill missing required profiles without overwriting archived authority. Full suite 500/500, build, package, and runtime closure pass; lint has 0 errors and 8 pre-existing warnings.

#### Review log

- Review cycle 1 — ISSUES_FOUND
  - BLOCKER, VALID: Windows `.cmd` shell encoding could fail on paths with spaces and permit metacharacter injection. Replaced by shell-free native Node invocation of the known npm package entrypoint; adversarial real-process regression test added.
  - MAJOR, VALID: Legacy archive restore could remove the autonomous profile until process restart. Required profiles are now re-ensured inside the restore transaction; archived profile authority remains authoritative.
- Review cycle 2 — APPROVED
  - Fresh reviewer confirmed both prior defects resolved, 51/51 focused tests passed independently, and found no blocker, major, minor, or cross-platform production regression. macOS/POSIX preservation is static and test-based; no macOS runtime was executed.

## Phase 2 — Package and conduct real Windows acceptance

- Status: DONE
- Tasks: 2/2
- Fix cycles: 3/4
- Review cycles: 0
- User checkpoint: NOT_REQUIRED

#### Runtime evidence and repairs

- Packaged Codex and Claude turns completed with exact expected responses; Claude streaming cancellation preserved its partial response and durable run history.
- DOCX, PDF, TXT, and Markdown imports passed through the native Windows file picker with correct extracted marker/provenance. Lexical indexing remained available while the absent local embedding model was reported truthfully.
- Selecting the built-in `Autonomous developer` profile exposed a blocker before provider launch: `Security profile exceeds the local execution budget boundary`. The execution-budget validator only accepted the conservative profile even though the store and UI intentionally create/select the bounded autonomous profile.
- Repair: accept only the exact bounded local autonomous authority shape (workspace write, on-write approval, the three expected local tool capabilities), while preserving the existing local-only, no-secret, no-peer, one-concurrent-run, 120-second ceiling and rejecting arbitrary widened tools or duration. Focused regression suite passes 44/44.
- Final packaged normal-profile smoke passed with exact `QA_FINAL_CODEX_OK` and `QA_FINAL_CLAUDE_OK` responses after the sanitized Windows child environment was repaired to retain only required runtime variables. Project-local npm `.bin` shims are also resolved shell-free.
- Restart preserved the normal profile, 1734x1385 window geometry, chats, imports, reflection history, notes, and accepted commitment. Workspace create/select passed; rename has no product surface and delete was not executed because the UI-control safety gate requires action-time confirmation.
- Knowledge review detected the explicit disposable commitment at 93%, accepted it with source provenance, surfaced it in Briefing, and passed complete/reopen. Local Codex reflection completed with five selected sources and no overwrite, truthfully returning zero proposals.
- Native Windows file dialogs imported PDF, DOCX, TXT, and Markdown fixtures with exact marker/provenance. Lexical search and reindex remained available; absent local embeddings were reported truthfully.
- In-App Browser refusal-before-policy and success-after-allowlisting `example.com` passed; `/browser open https://example.com` completed. Brave, Chrome, and Edge were detected/selectable; Firefox truthfully remained unavailable because containment is unverified. Brave web search remained unavailable without its API key.
- Voice/media readiness and device status rendered without microphone recording. Meetings required explicit consent and no capture was started. Windows-specific `this Mac` copy was repaired to `this device` in meetings and sync-owner prompts.
- Cross-workspace explicit briefing-status grant, one-item preview, and provenance exclusion disclosure passed. No second device was available, so direct-host/cross-device runtime behavior remained unavailable.

## Phase 3 — Repair, retest, and final verification

- Status: DONE
- Tasks: 2/2
- Fix cycles: 1/4
- Review cycles: 1 completed; bounded Codex review attempts timed out without findings
- User checkpoint: NOT_REQUIRED

#### Final verification

- Full suite: 504/504 PASS across 113 files.
- Lint: 0 errors, 8 pre-existing React-hook warnings.
- Windows directory package/build: PASS with Node 24.15.0/npm 12.0.1.
- Final executable SHA-256: `31AAFCBEB4C234DD902A604A77EA77C3FE40C3E93B45AB5656ED2CE6E13E8E81`.
- Fresh Claude read-only diff review found one valid Windows child-environment issue; repaired and covered. Its missing-helper claim was disproved by the existing method and successful build, and the shim-layout concern was addressed with bounded project-local support.

## Deferred MINOR findings

- Packaged Fast Local resources and runtime load correctly, but the strict first-audio gate is intermittent around the 1,000 ms boundary: direct measurements clustered near 980-995 ms with occasional 1,005-1,030 ms misses. Do not relax the SLA; optimize or make first playable output earlier.
- Reflection run-history layout overflows horizontally in the 430 px drawer at this Windows window size.
- Workspace rename is absent; package is directory-only with version `0.0.0`, so installer/upgrade acceptance is unavailable.

## Blockers

- None.
