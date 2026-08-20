# Build to Complete State: Model-Directed Configuration Tools

- Source: `D:\Repos\Waypoint\.codex\build-to-complete\model-directed-configuration-tools.plan.md`
- Repository: `D:\Repos\Waypoint`
- Branch: `main`
- Started: `2026-08-14T19:01:36-04:00`
- Updated: `2026-08-14T19:35:35-04:00`
- Baseline worktree: dirty with 142 pre-existing paths at `29aa82e532d22df3702a2411a81eeeeac9f7772e`; preserve all unrelated changes
- Current phase: 1 of 1
- Overall status: IN_PROGRESS
- Build status: SOURCE_GATES_PASS
- Confidence: HIGH

## Phase ledger

### Phase 1 — Always-available model-selected configuration

- Status: IN_PROGRESS
- Tasks: 4/5
- Fix cycles: 1/4
- Review cycles: 1
- User checkpoint: REQUIRED

#### Acceptance contracts

##### Task 1.1 — Provider-native tool availability

- Outcome: Codex, Claude, and Grok expose the bounded Waypoint automation proposal tool on every direct root chat turn without reduced authority or a special mode.
- Non-goals: no keyword routing; no direct provisioning from the proposal tool; no child-task proposal authority.
- Files/subsystems: provider adapters, chat composition, provider sessions, proposal callback.
- Artifacts: always-available schemas/instructions and at-most-one proposal guard.
- Integration path: root chat -> provider catalog -> proposal callback -> pending card.
- Automated proof: provider and main-composition tests.
- Runtime proof: signed-in local provider probes.
- Visual/manual proof: provider controls remain normal.
- Decisions/external inputs: signed-in local CLIs already available.

##### Task 1.2 — OpenRouter parity

- Outcome: OpenRouter always receives a dedicated bounded automation proposal tool independently of broad Waypoint-command authority.
- Non-goals: no expansion of general Waypoint commands or profile authority.
- Files/subsystems: hosted tool catalog, hosted execution routing, proposal finalization.
- Artifacts: exact JSON schema, direct bounded handler, one-proposal guard.
- Integration path: hosted tool call -> shared proposal callback -> pending card.
- Automated proof: OpenRouter tool and integration tests.
- Runtime proof: live only if a configured protected key is available.
- Visual/manual proof: OpenRouter remains selectable only when configured.
- Decisions/external inputs: protected-key availability may be unavailable.

##### Task 1.3 — Session compatibility and migration

- Outcome: legacy Codex/Grok sessions lacking the tool are not resumed; their conversation context is bridged to a fresh tool-capable session exactly once.
- Non-goals: no recurring session resets and no chat-history loss.
- Files/subsystems: store migration, provider-session selection, prompt bridge.
- Artifacts: versioned migration and preservation regression.
- Integration path: startup migration -> stale legacy binding -> fresh provider session -> durable rebinding.
- Automated proof: migration/store/main tests.
- Runtime proof: resume/new session probes.
- Visual/manual proof: reopened chat remains coherent.
- Decisions/external inputs: none.

##### Task 1.4 — Composer and help truthfulness

- Outcome: remove Automate state/button/hints/API parameter and document automatic model tool choice plus transaction approval.
- Non-goals: no redesign of provider/profile/model controls.
- Files/subsystems: renderer, preload/types, CSS, product help.
- Artifacts: visible composer and help copy.
- Integration path: app startup -> composer render -> send without mode flag.
- Automated proof: renderer/API/product-help tests.
- Runtime proof: rebuilt app inspection.
- Visual/manual proof: no toggle and no layout regression.
- Decisions/external inputs: user validation after rebuild.

##### Task 1.5 — Whole-flow verification and delivery

- Outcome: full gates, package closure, Windows artifact, phase review, and two independent whole-project reviews pass with no unresolved BLOCKER/MAJOR.
- Non-goals: no source commit/push unless requested.
- Files/subsystems: whole repository and release artifact.
- Artifacts: rebuilt installer and exact receipts.
- Integration path: source -> build -> package -> runtime -> installed checkpoint.
- Automated proof: full tests/build/lint/help/diff/package closure.
- Runtime proof: signed-in local provider and packaged UI.
- Visual/manual proof: Program Files installation after UAC approval.
- Decisions/external inputs: action-time UAC confirmation.

#### Task evidence

- [x] Task 1.1 — PASS. Codex, Claude, and Grok receive the bounded proposal tool on every direct root turn while retaining the selected profile's normal authority. Focused provider suite passed; live signed-in Claude/Codex proof returned two exact proposal calls; live Grok proof returned one exact proposal while retaining normal tools.
- [x] Task 1.2 — PASS. OpenRouter advertises `waypoint_automation_proposal` independently of broad `waypoint.command`, routes it directly to the shared pending-proposal callback, deduplicates calls, and appends the truthful prepared summary.
- [x] Task 1.3 — PASS. Schema v46 stales legacy active Codex/Grok sessions once, preserves Claude resume, bridges prior Waypoint chat history into fresh provider sessions, and rebinds the new session. Store migration regression passed.
- [x] Task 1.4 — PASS. Renderer state/button/CSS, preload/API flag, reduced-authority branches, and explicit-mode help copy are removed. Composer reports model-selected configuration tools ready.
- [ ] Task 1.5 — IN_PROGRESS. Full source gates pass: 155 files / 799 tests, build, lint, help, and diff check. The rebuilt Windows installer and package closure pass; exact packaged bytes prove the mode is absent and all four providers expose the bounded proposal tool. Two final fresh-context whole-project reviews are running; installed UI/UAC checkpoint remains.

#### Review log

- Phase review cycle 1 — MAJOR: pre-confirmation Azure/GitHub target discovery used `local_cli.run` under the default developer policy instead of the selected profile.
- Fix cycle 1 — Removed all provider CLI/network discovery from proposal preparation. The explicit confirmation now authorizes resolving the exact named provider target; stable IDs are resolved only inside the approved transaction, checked against any approved IDs, and retained in the provider mutation audit receipt. Added pre-confirmation boundary and deferred-discovery regressions.
- Phase re-review — CLEAN from fresh-context reviewer `model_directed_phase_review`.
- Final fresh-context reviews dispatched to `model_directed_final_arch` and `model_directed_final_runtime`; verdicts pending.

#### Runtime evidence

- `npx tsx .codex/build-to-complete/live-native-automation-tool.ts` — PASS: `{"ok":true,"calls":2,"providers":["claude","codex"],"eventTypes":["generic.live.proof","generic.live.proof"]}`.
- `npx tsx .codex/build-to-complete/live-grok-workbench-automation.ts` — PASS: signed-in Grok 1.0.3 / grok-4.6, exact proposal count 1, normal authority retained, slash skill proof passed.
- `npm test` — PASS: 155 files / 799 tests.
- `npm run build` — PASS.
- `npm run lint` — PASS with zero warnings.
- `git diff --check` — PASS aside from existing line-ending notices.
- `npm run package:release:windows` — PASS: `D:\Repos\Waypoint\release\Waypoint-0.0.0-win-x64.exe` (348,121,772 bytes), SHA-256 `CD40FF8EE3F0F1F9BF7EDDC6BCB5383EFE7C371B482E6D709F8560E6DA3ED63C`.
- Exact ASAR SHA-256 `6D2226DA1EC4CC279693B27B2074113EA674B15133F093595208F9BE65377DBE`; unpacked executable SHA-256 `4D3B3EE0672D102C4338DACDEC0642A03B1BE23A71E065778109EDEFFB2F884C`.
- `npm run verify:package-runtime` — PASS; Fast Local first playable audio 355.65 ms.
- Exact ASAR inspection — PASS: no `automationPlanning`, no Automate button marker, model-selected ready copy present, all Codex/Claude/Grok/OpenRouter proposal tools present, no pre-confirmation CLI discovery, deferred approved discovery present.

#### User checkpoint

- Why required: final installed Windows UI requires UAC and visual confirmation.
- Build/URL/artifact: `D:\Repos\Waypoint\release\Waypoint-0.0.0-win-x64.exe`.
- Validation checklist: no Automate button; model-selected tool behavior; provider controls intact.
- Feedback: pending.
- Approval: pending.

## Deferred MINOR findings

- None.

## Blockers

- None.
