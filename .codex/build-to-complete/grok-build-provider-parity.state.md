# Build to Complete State: Grok Build Provider Parity

- Source: D:\Repos\Waypoint\.codex\build-to-complete\grok-build-provider-parity.plan.md
- Repository: D:\Repos\Waypoint
- Branch: main
- Started: 2026-08-14T00:00:00-04:00
- Updated: 2026-08-14T18:43:00-04:00
- Baseline worktree: dirty at 29aa82e532d22df3702a2411a81eeeeac9f7772e with 117 pre-existing modified/untracked paths; every pre-existing path is user-owned and must be preserved. The exact baseline was captured by `git status --porcelain=v1` immediately before this state file was created.
- Current phase: 4 of 4
- Overall status: AWAITING_USER_VALIDATION
- Build status: PASS
- Confidence: HIGH

## Phase ledger

### Phase 1 — Discovery, ACP protocol, identity, and authority foundation

- Status: COMPLETE
- Tasks: 4/4
- Fix cycles: 3/4
- Review cycles: 3
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

##### Task 1.1 — No-reboot cross-platform discovery

- Outcome: Waypoint discovers compatible installed Grok Build CLIs from PATH and standard per-user locations, including a Windows installation whose PATH is stale until reboot.
- Non-goals: Installing Grok, modifying machine/user PATH, or bundling the executable.
- Files/subsystems: CLI capability detection, packaged runtime closure, product readiness.
- Artifacts: discovery/version parser and sparse-environment regressions.
- Integration path: renderer readiness -> main capability detection -> standard path probe -> exact executable/version receipt.
- Automated proof: Windows/macOS/Linux path candidates, symlink/file identity, version compatibility, sparse PATH, and missing/incompatible CLI tests.
- Runtime proof: `C:\Users\scott\.grok\bin\grok.exe` is discovered although this process inherited no Grok PATH entry.
- Visual/manual proof: provider selector shows Grok available without restart/reboot.
- Decisions/external inputs: installed Grok 1.0.3 is the current verified baseline; ACP v1 runtime validation permits compatible 1.x releases.

##### Task 1.2 — Native ACP lifecycle

- Outcome: stable ACP provides initialization, signed-in identity preflight, new/resumed sessions, exact model selection, structured streaming, requests, terminal status, and fail-closed schema handling.
- Non-goals: TUI scraping, headless plain-text emulation, or credential handling.
- Files/subsystems: new Grok ACP adapter, official ACP SDK, execution events, provider decision bridge.
- Artifacts: fake-protocol tests and live verification harness.
- Integration path: main -> Grok workbench -> `grok agent stdio` -> ACP -> Waypoint store/renderer.
- Automated proof: handshake, auth, new/load/resume, identity mismatch, update variants, permission requests, malformed messages, crash, and protocol drift.
- Runtime proof: live signed-in Grok read turn plus exact resumed second turn.
- Visual/manual proof: assistant prose and structured activity stream separately.
- Decisions/external inputs: strip API-key environment variables and require the CLI's `grok.com` login report before prompt release.

##### Task 1.3 — Authority, approval, and cancellation

- Outcome: all four Waypoint profiles map truthfully to Grok; requests are durable/idempotent; selected-root identity is revalidated; cancellation kills the Windows process tree and waits before reporting terminal state.
- Non-goals: Pretending Windows host shell is sandbox-contained or letting Bypass escape structured selected-root checks.
- Files/subsystems: ACP permission handler, profile mapper, redaction, process lifecycle.
- Artifacts: policy tests, root/junction probes, secret-redaction tests, real descendant-cancel proof.
- Integration path: ACP permission request -> durable card -> scoped response -> Grok; Stop -> ACP cancel -> verified process-tree exit.
- Automated proof: allow once/session drift, decline, duplicate IDs, outside-root paths, Bypass, process descendants, and redaction.
- Runtime proof: disposable Developer write requires approval; decline writes nothing; Bypass writes with no card and remains cancelable.
- Visual/manual proof: readable dark/light approval card and truthful Windows warning.
- Decisions/external inputs: none.

##### Task 1.4 — Live signed-in proof

- Outcome: this installed Grok account and model catalog work through the same adapter Waypoint will package.
- Non-goals: External production writes or authenticated web actions.
- Files/subsystems: live verification harness and disposable QA workspace.
- Artifacts: version/account/model/session/cancel evidence with cleanup receipt.
- Integration path: exact discovered executable -> adapter -> disposable repository.
- Automated proof: harness assertions plus focused tests/build/lint.
- Runtime proof: current CLI already reports `grok 1.0.3`, `You are logged in with grok.com`, default `grok-4.6`, and available `grok-4.5`.
- Visual/manual proof: not required in Phase 1.
- Decisions/external inputs: all live operations remain disposable and local.

#### Task evidence

- [x] Task 1.1 — COMPLETE
  - Evidence: current shell does not resolve `grok`, while standard-path discovery and execution at `C:\Users\scott\.grok\bin\grok.exe` succeeds; Windows/macOS/Linux candidate and compatibility regressions pass in `spikes/cli-capabilities.test.ts`.
- [x] Task 1.2 — COMPLETE
  - Evidence: the official ACP SDK adapter validates protocol 1, exact CLI version/account/model provenance, strictly rejects malformed JSON/schema messages, streams typed updates, paginates exact session inventory, supports explicit load and exact resume, and rejects session drift before prompt release.
- [x] Task 1.3 — COMPLETE
  - Evidence: focused approval/redaction/authority/cancel tests pass; Bypass retains selected-root enforcement for every declared structured path; a hanging subscription preflight is cancelable; the live Developer write was declined with no file created; the live Bypass write succeeded; Windows cancellation killed and awaited a real PowerShell descendant.
- [x] Task 1.4 — COMPLETE
  - Evidence: `.codex/build-to-complete/live-grok-agent-verification.ts` passed against signed-in Grok 1.0.3 with explicit load, exact resume, declined write, Bypass write, real descendant cancellation, and cleanup. Focused 37 tests, production build, and lint pass.

#### Review log

- Cycle 1 — ISSUES_FOUND (fresh adversarial review)
  - MAJOR: the upstream ACP stream helper logged and continued after malformed JSON/schema messages, permitting a false completed result.
  - MAJOR: Bypass classified some declared outside-root paths as non-file tools and could auto-approve them.
  - MAJOR: remote/device Grok execution did not independently enforce CLI compatibility before prompt release.
  - MAJOR: the signed-in `grok models` preflight was outside the active cancel lifecycle and could hang Stop/shutdown.
  - MAJOR: durable Grok lifecycle used new/list/resume but omitted the explicit ACP session/load path.
  - MAJOR: no live descendant-process cancellation proof existed.
- Fix cycle 1
  - Replaced the lenient ACP decoder with strict JSON and method/schema validation while accepting only notification-only `_x.ai/*` extensions.
  - Enforced canonical selected-root containment for every declared path before Bypass auto-approval.
  - Added adapter-local compatibility gating, cancelable signed-in subscription preflight, explicit session/load with replay suppression, and live Windows process-tree verification.
  - Focused 37/37 tests, build, lint, and signed-in live proof pass; awaiting fresh re-review.
- Cycle 2 — ISSUES_FOUND (fresh re-review)
  - MAJOR: the first strict validator did not validate nested ACP content variants, so an invalid `agent_message_chunk.content.type` could still be logged upstream and followed by a false completed result.
  - MAJOR: session/load replay suppression ran before exact session-ID validation and could hide a mismatched-session update.
- Fix cycle 2
  - Bound standard notifications and permission requests to the exact pinned official ACP 1.3.0 generated schemas before the SDK sees them.
  - Moved exact session-ID validation ahead of provider-history replay suppression.
  - Added raw JSON, shallow schema, nested schema, and load-session-drift integration regressions. Focused 28/28 tests, build, lint, and the complete signed-in live proof pass; awaiting fresh re-review.
- Cycle 3 — ISSUES_FOUND (compiled-runtime review)
  - BLOCKER: the first official-schema import used a source-layout-relative path that TypeScript preserved under `dist-electron`, where the compiled main process could not resolve it.
- Fix cycle 3
  - Resolve the pinned SDK entry through Node package resolution at runtime, then load its co-packaged generated schema from that authoritative package root; the source-only path remains type-only and is erased.
  - Focused 16/16 tests, build, lint, and a direct import of `dist-electron/electron/core/grok-agent-acp.js` pass with `BUILT_GROK_IMPORT_OK`; awaiting fresh re-review.
- Cycle 4 — CLEAN
  - Fresh bounded review verified the compiled adapter import, nested official-schema rejection, runtime-stable schema resolution, session identity before load suppression, focused 16/16 tests, build, and lint. No reproducible BLOCKER/MAJOR remains.

### Phase 2 — Durable store, routing, renderer, and model parity

- Status: COMPLETE
- Tasks: 4/4
- Fix cycles: 2/4
- Review cycles: 2
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

##### Task 2.1 — Durable three-provider data model

- Outcome: current and migrated stores persist Grok executions, sessions, requests, model preferences, and automation audit rows alongside Codex and Claude.
- Non-goals: synchronizing provider credentials or assuming identical account catalogs across devices.
- Files/subsystems: schema v44, migrations, workspace store, backup/restore, sync-safe provider metadata.
- Artifacts: current-schema, incremental migration, restored-session staling, request/audit, malformed archive, and model round-trip tests.
- Integration path: renderer IPC -> main -> store -> SQLite/backup -> reopen/reconciliation.
- Automated proof: migration through v44, no-rerun receipt, Grok session/request/execution backup round-trip, stale restored session, and persistent model preference.
- Runtime proof: full 154-file/779-test suite passes against the current store implementation.
- Visual/manual proof: not required for the data-model task.
- Decisions/external inputs: provider authentication remains outside the store.

##### Task 2.2 — Routing and lifecycle parity

- Outcome: Grok participates in local route proposals, execution, exact resume/reset, reflection, child delegation, auto-title, active cancellation, and chat reopen without changing Codex/Claude behavior.
- Non-goals: OpenRouter fallback for Grok or cross-device reuse of local provider sessions.
- Files/subsystems: main/preload API, provider routing, execution registry/finalization, auto-title, agent policy.
- Artifacts: route, child-policy, title-lane, session-reset, execution-lifecycle, and provider-foundation tests.
- Integration path: composer -> route proposal -> native Grok workbench -> durable events/session -> renderer/reopen.
- Automated proof: identical-authority Grok child delegation, provider-only uncapped title lane, route selection, session reset, active cancel, and stale-session reconciliation.
- Runtime proof: Phase 1 live exact resume and cancellation use the same workbench wired into main.
- Visual/manual proof: final installed UI acceptance remains Phase 4.
- Decisions/external inputs: local-only signed-in CLI routing; no silent provider fallback.

##### Task 2.3 — Composer, Settings, and model truthfulness

- Outcome: Grok appears as a third native provider only when its compatible installed CLI and signed-in grok.com model inventory are verified; Settings shows exact readiness/version/reason and model choices persist per workspace.
- Non-goals: guessing account-scoped models or treating binary presence as successful login.
- Files/subsystems: streamed model catalog, renderer composer/Settings, model preferences, Waypoint API declarations.
- Artifacts: parser/readiness/model UI tests and real installed inventory receipt.
- Integration path: renderer -> model-catalog IPC -> no-reboot discovery -> `grok models` -> signed-in provenance -> selector.
- Automated proof: signed-in provenance rejection, exact indented CLI output parsing, custom/legacy model visibility, and accessible selector tests.
- Runtime proof: current installed Grok 1.0.3 returns ready with Grok 4.6 and 4.5 without reboot; inventory has no Waypoint timeout/buffer cap and is process-tree-canceled during shutdown.
- Visual/manual proof: final installed taskbar/UI pass remains Phase 4.
- Decisions/external inputs: the installed CLI's model catalog is authoritative.

##### Task 2.4 — Attachment and visible-output truthfulness

- Outcome: ACP text and integrity-checked run-scoped PDF/DOCX/TXT/Markdown file paths are deliverable through Grok's native tools without a Waypoint file-size cap; Grok images remain local because its current ACP capability does not advertise image input; assistant text remains a visible durable event outside collapsed structured activity.
- Non-goals: inventing unsupported image transport or silently discarding attachments.
- Files/subsystems: route registry, attachment preparation/context, renderer execution presentation, canonical output.
- Artifacts: Grok attachment-route, provider-context, collapsed-activity, and streamed-output tests.
- Integration path: chat attachments -> route provenance -> run-scoped local snapshot -> Grok prompt/native file tools -> durable text/tool events -> renderer.
- Automated proof: deliverable/local-only attachment IDs, Grok chunk assembly, and shared execution-presentation tests.
- Runtime proof: signed-in live Grok prose streamed through typed ACP message events.
- Visual/manual proof: final installed UI pass remains Phase 4.
- Decisions/external inputs: current Grok ACP reports image input unsupported.

#### Task evidence

- [x] Task 2.1 — COMPLETE
  - Evidence: schema v44, v44 migration, provider constraints, model preference, backup/restore, stale-session reconciliation, and malformed-data gates pass in the full suite.
- [x] Task 2.2 — COMPLETE
  - Evidence: Grok is wired through main/preload/API, route, lifecycle, title, reflection, child delegation, exact session reset/resume, and all active-run cancellation/shutdown registries; focused and full tests pass.
- [x] Task 2.3 — COMPLETE
  - Evidence: real compiled model inventory discovers `C:\Users\scott\.grok\bin\grok.exe` outside PATH and returns `ready: true`, version 1.0.3, Grok 4.6/4.5, and signed-in grok.com provenance. Inventory streaming is uncapped and shutdown-cancelable.
- [x] Task 2.4 — COMPLETE
  - Evidence: route and renderer tests preserve unsupported images locally with truthful copy, locally extract supported documents, retain Grok stream chunks as assistant prose, and keep structured activity independently collapsible.

#### Build/runtime gate

- Focused Phase 2 tests: PASS (8 files/36 tests, followed by catalog regression 1 file/8 tests).
- Full tests: PASS (154 files/780 tests). One pre-existing Windows PID-file EBUSY flake failed the first parallel run; its isolated rerun and subsequent full reruns passed.
- Build: PASS.
- Lint: PASS.
- Diff check: PASS with only repository CRLF conversion warnings.
- Real installed model inventory: PASS without reboot.

#### Review log

- Cycle 1 — ISSUES_FOUND (fresh adversarial review)
  - MAJOR: provider capability/model readiness was sampled only at app launch, so installing or signing into Grok while Waypoint remained open required a Waypoint restart despite no Windows reboot being necessary.
  - MAJOR: the first refresh implementation allowed overlapping uncapped inventory children, and an automatic refresh could supersede an announced refresh while leaving its button permanently busy.
  - MAJOR: model-catalog shutdown initially snapshotted active children once; a sequential catalog could start the next provider after shutdown returned.
- Fix cycle 1
  - Refresh provider installation, compatibility, account provenance, and models whenever Settings opens and through an explicit accessible control.
  - Coalesce every renderer request onto one in-flight refresh and clear busy state from the owning task on every result.
  - Gate new inventory spawns at shutdown, pass an app-lifetime abort signal through the whole sequence, process-tree terminate active children, track whole catalog operations, and drain both registries before exit.
  - Added cancellation/concurrency regressions; focused tests, full 154-file/780-test suite, build, and lint pass.
- Cycle 2 — CLEAN
  - Fresh re-review found 0 BLOCKER/MAJOR/MINOR. The reviewer independently verified the compiled no-reboot Grok 1.0.3 inventory and exact grok-4.6/grok-4.5 models; the shutdown race probe passed 5/5 with no early return.

### Phase 3 — Native skills, MCP/subagents, and safe automation parity

- Status: COMPLETE
- Tasks: 4/4
- Fix cycles: 1/4
- Review cycles: 2
- User checkpoint: NOT_REQUIRED

#### Task evidence

- [x] Task 3.1 — COMPLETE
  - Evidence: normal Grok turns preserve leading slash input and the real entry point passes the exact parsed identifier into a refreshed `grok inspect --json` inventory check before prompt release. A disposable project skill named `waypoint-parity-proof` was discovered and invoked through the production adapter with `GROK_SLASH_PARITY_OK`; missing, non-invocable, incompatible, and prompt-mismatched exact skills fail before prompt release.
- [x] Task 3.2 — COMPLETE
  - Evidence: normal chat retains the real Grok home/config and existing ACP tool/plan/command/question/failure event mapping. The live slash proof exercised the normal configuration path. Automate alone replaces HOME/GROK_HOME, CWD, compatibility imports, hooks, skills, subagents, web search, sandbox, and default tool injection.
- [x] Task 3.3 — COMPLETE
  - Evidence: Grok Automate creates marked disposable home/root directories, points the CLI at the existing auth file without reading/copying it, uses a curated `use_tool` profile, admits only `waypoint__search_tool` for the local proposal schema and `waypoint__automation_proposal`, strictly validates reverse MCP, denies/aborts every other target, and requires both exact tool inventory and completed MCP initialization before releasing the prompt. The real signed-in Grok 1.0.3 / grok-4.6 run prepared exactly one pending proposal with no approval or external mutation; external connector names were absent from durable events.
- [x] Task 3.4 — COMPLETE
  - Evidence: Grok is accepted by proposal/action/store/runtime provider constraints; automation startup passes the exact skill identifier to the Grok adapter; provider sessions, cancellation, finalization, and restart reconciliation share the native three-provider path. A schema error is returned in-turn and a corrected proposal can succeed; completion without a successful proposal fails.

#### Build/runtime gate

- Focused Phase 3 tests: PASS (8 files/65 tests in the final review snapshot).
- Full tests: PASS (154 files/787 tests) after permission-boundary and entry-point hardening.
- Build: PASS.
- Lint: PASS.
- Real signed-in slash skill: PASS (`waypoint-parity-proof` -> `GROK_SLASH_PARITY_OK`).
- Real signed-in Automate: PASS (Grok 1.0.3, grok-4.6, one validated `Grok signed-in proof` pending proposal, zero approval cards, no external connector events, nothing provisioned or enabled).
- Cleanup: disposable successful-run data removed; crash-stranded exact-prefix directories were recovered. Startup cleanup now additionally requires an exact ownership marker and preserves unmarked matching folders.
- Diff check: PASS with repository CRLF conversion warnings only.

#### Review log

- Cycle 1 — ISSUES_FOUND (fresh adversarial review)
  - MAJOR: multiple successful reverse-MCP proposal calls could create multiple pending cards in one turn.
  - MAJOR: pre-session tool updates and an out-of-order reverse-MCP lifecycle could satisfy readiness before the exact session boundary was proven.
  - MAJOR: normal dynamic MCP calls wrapped as `use_tool` were classified by the wrapper name instead of the effective `server__tool` target, bypassing profiles without MCP authority.
  - MAJOR: a one-time Waypoint approval could fall back to Grok's `allow_always` option.
  - MAJOR: the real interactive slash entry point preserved its leading slash but did not pass the exact identifier into the Grok inventory preflight.
- Fix cycle 1
  - Enforced exactly one successful proposal callback, strict session-bound MCP initialization/list/call ordering, wrapper-aware MCP classification, exact `allow_once` selection, and real-entry-point slash identifier binding.
  - Added valid-then-valid, wrong-pre-session, out-of-order MCP, wrapped MCP deny/allow, missing allow-once, and main-composition regressions.
  - Re-ran the real signed-in Grok 1.0.3/grok-4.6 slash plus Automate proof: exactly one pending proposal, zero approval cards, no forbidden tools, no external mutation, and no residual isolation directories.
- Cycle 2 — CLEAN
  - Independent re-review passed 8 files/65 focused tests, the 154-file/787-test full suite, build, lint, diff check, and the live signed-in proof. No BLOCKER/MAJOR/MINOR remains.

### Phase 4 — Full gates, package closure, and installed Windows acceptance

- Status: AWAITING_USER_VALIDATION
- Tasks: 3/4
- Fix cycles: 1/4
- Review cycles: 2
- User checkpoint: REQUIRED

#### Task evidence

- [x] Task 4.1 — COMPLETE
- Evidence: focused and full gates pass (154 files/797 tests), plus build, lint, diff check, dependency audit/signature/policy checks, the real v44-to-v45 provider/settings/receipt/hosted-run/event migration, backup/restore coverage, and exact package-runtime closure. Fast Local packaged startup completed in 333.79 ms.
- [x] Task 4.2 — COMPLETE
  - Evidence: the exact rebuilt ASAR contains zero compiled application tests, provider executables, credentials, or auth/config payloads. Packaged Grok, Codex, and Claude imports pass; sparse-PATH packaged discovery finds compatible signed-in Grok 1.0.3 at `C:\Users\scott\.grok\bin\grok.exe`; macOS/Linux branches are statically preserved but were not executed on this Windows machine.
- [ ] Task 4.3 — AWAITING_USER_VALIDATION
  - Evidence: the exact rebuilt unpacked app was exercised through computer control and shows `grok · local CLI`, Grok default, Grok 4.6, and Grok 4.5 with truthful attachment/model copy. The current Program Files installation is still the older build. Two attempts to launch the new installer reached Windows elevation and were canceled, so taskbar/Program Files acceptance was not manufactured.
- [x] Task 4.4 — COMPLETE
- Evidence: the Phase 4 fresh adversarial review is CLEAN after excluding compiled application test files from the package and making package closure fail closed if any return. Two independent whole-project reviewers then verified the exact rebuilt ASAR, installer, and executable hashes; packaged modules match current compiled output, package-runtime closure passes, sparse-PATH discovery finds external Grok 1.0.3, and the artifact contains no application tests, provider CLIs, credentials, or auth/config payloads.

#### Exact release receipts

- ASAR SHA-256: `436FA8C2C8939ED35DE98C9613E4CA819A376F78187F8A752AB49B68EA77CE21`
- Installer SHA-256: `2151E9A05D22888E106A562366DCFAB33769A2BB95727FCD294B000895FCB673`
- Packaged executable SHA-256: `88CAD0CC10EADECF00600DAAEDD598E2B58D3494F789ECF53D98AA4BA46062BA`

#### Review log

- Cycle 1 — MINOR_FOUND
  - MINOR: broad package globs included compiled `*.test.js` application files and synthetic fixtures in the ASAR.
- Fix cycle 1
  - Excluded `dist-electron/electron/**/*.test.js` from the application package and added a fail-closed package-runtime assertion plus regression test.
- Cycle 2 — CLEAN
  - Fresh re-review confirmed zero compiled application tests, no provider binaries/auth/config, exact sparse-PATH Grok discovery, packaged provider imports, package closure, and independent artifact hashes. No BLOCKER/MAJOR/MINOR remains in the phase scope.
- Cycle 3 — ISSUES_FOUND (two independent whole-project reviews)
  - BLOCKER/MAJOR findings covered selected-root attachment TOCTOU, Grok startup concurrency, strict ACP schema/envelope roles, permission/MCP/command spoofing, exact approval auditability and secret redaction, provider model provenance, no-tools title/reflection isolation, authenticated cleanup ownership, Windows first-profile initialization, v44-to-v45 provider fallback preservation, Grok diagnostics/timeline/readiness, and Grok OpenRouter cap fallback.
- Fix cycle 2
  - Bound file snapshots to canonical roots and revalidated bytes immediately before prompt release; made ACP parsing lossless and envelope-strict; made permission classification/path extraction/auditing fail closed; isolated metadata lanes; HMAC-authenticated both cleanup families with first-profile-safe key initialization; added Grok fallback schema v45 with semantic-column migration; completed diagnostics/timeline/readiness/UI parity; and added focused regressions for every reproduced case.
  - Full 154-file/797-test suite, build, lint, diff check, signed-in Grok chat/resume/load/decline/Bypass/cancel proof, signed-in slash/Automate proof, and package-runtime closure pass.
- Cycle 4 — CLEAN
  - Both independent reviewers report source and exact rebuilt artifacts CLEAN with zero BLOCKER/MAJOR/MINOR findings. They independently matched the ASAR, installer, and executable hashes above, verified packaged-module byte identity, package-runtime closure, external sparse-PATH Grok discovery, and the absence of bundled provider CLIs, credentials, auth/config payloads, and compiled application tests.

## Deferred MINOR findings

- None.

## Blockers

- User checkpoint only: installed Program Files Waypoint is known to predate the current source/release work. Two new installer launches were canceled at Windows elevation. Final installed/taskbar acceptance requires the user to approve a newly elevated install; until then the truthful result is `AWAITING_USER_VALIDATION`.
