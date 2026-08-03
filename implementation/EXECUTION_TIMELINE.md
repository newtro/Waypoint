# Waypoint execution timeline

## Controls

- Scope source: the approved planning set in `outputs/`.
- Security profile: workspace-only writes, no secrets, read-only CLI capability probes, no remote service invocation.
- Stop control: the user may stop work at any time; no phase advances without a clean gate.
- Prohibited without follow-up authorization: deploy, publish, or external integration. Verified phase-gate commits and pushes to the authorized private repository are allowed.
- Environment constraint: Docker is never required for build, test, setup, or runtime; native macOS/Windows paths are mandatory.

## Phase 0 — validation and technical spikes

- Executor: primary implementation task.
- Reviewer: fresh independent agent context, selected to avoid builder-rationale bias.
- Status: completed; verification and independent review pass with no unresolved blocker/high finding.
- Acceptance criteria:
  1. Electron + React + TypeScript shell builds, launches, and packages natively on supported macOS and Windows with renderer sandboxing enabled; bounded filesystem, update-path, and child-process behavior is validated. The workflow must remain Docker-free.
  2. Codex and Claude Code capability detection is side-effect free and reports actionable structured state.
  3. Local vector generation is benchmarked and its limitations are explicit.
  4. Sync/deletion convergence behavior has executable tests, including stale-peer anti-resurrection.
  5. Object ownership, encryption posture, coordinator trust boundary, retention, and platform support are recorded as bounded Phase 0 decisions.
  6. Type, lint, tests, build, and local packaging pass.
  7. Independent review has no unresolved blocker or high-severity finding.

## Phase 1 — local product alpha

- Executor: primary implementation task.
- Reviewer: fresh independent agent context, selected to avoid builder-rationale bias.
- Status: completed; verification and independent adversarial review pass with no unresolved blocker/high finding.
- Scope and acceptance criteria: `implementation/PHASE_1_PLAN.md`.
- Evidence: `implementation/PHASE_1_EVIDENCE.md`.

## Phase 2 — AI workbench alpha

- Status: current-Mac gate completed; see `implementation/PHASE_2_PLAN.md` and `implementation/PHASE_2_EVIDENCE.md`.

## Phase 3 — multi-peer private-beta foundation

- Status: Mac-local protocol foundation completed; see `implementation/PHASE_3_PLAN.md` and `implementation/PHASE_3_EVIDENCE.md`. Real Windows/Ubuntu/TLS/public-network evidence remains open.

## Phase 4 — current-Mac hardening release candidate

- Executor: Phase 4 implementation task.
- Reviewer: fresh independent context, with focused re-review after four high-severity findings were repaired.
- Scope and criteria: `implementation/PHASE_4_PLAN.md`.
- Evidence: `implementation/PHASE_4_EVIDENCE.md`.

## Current gate

Phase 4 current-Mac verification is recorded in its evidence. The signed/published cross-platform release gate remains open.

Windows-native build/package/launch, filesystem, update-path, and child-process validation is required immediately when the project moves to Windows, by explicit user decision.

## 2026-08-03 — First-Class Chat repair

- Reproduced the packaged-GUI CLI discovery failure and repaired native executable resolution.
- Added retry-safe terminal finalization, durable chat attachment ownership and lifecycle, truthful provider delivery, immediate New Chat, retry controls, and full-height responsive layout.
- Repaired three independent-review high findings: stale startup-failure state, inexact historical retry, and provider-receipt overclaim. Exact retry provenance required schema 6.
- Passed 161 tests, lint, production build, high-severity audit, bounded live Codex/Claude completion/failure/cancellation checks, native arm64 packaging, and focused independent re-review.
- Windows-native and signed/published release verification remain explicitly deferred.

## 2026-08-03 — Packaged runtime path repair

- Reproduced the macOS `ERR_MODULE_NOT_FOUND` before SQLite opened: the package excluded the compiled CLI-capability module required by main-process startup.
- Included the required compiled runtime subtree and added an `app.asar` relative-import closure gate plus exact regression test.
- Preserved and reopened the existing workspace/messages through the normal schema migration; native package launch now renders without the error dialog.

## 2026-08-03 — Chat-first UI rework

- Replaced the dashboard shell with persistent left chat navigation, full-width transcript, grounded composer, and invoked knowledge/settings drawer.
- Added history search/grouping/sort, reachable data management, keyboard/modal accessibility, atomic conversation-to-knowledge capture, and validated local window-state restoration.
- Independent review findings were repaired before final packaging; Windows verification remains platform-contingent.

## 2026-08-03 — Future roadmap R0 readiness audit

- Selected next ordered phase: **R0 — authority, trust, and protocol freeze** from `outputs/FUTURE_IMPLEMENTATION_READINESS.md`.
- Status: blocked before implementation. The phase exit gate requires explicit user approval of node region/account/cost ceiling, relay-visible metadata, recovery method, peer-expiry/tombstone policy, backup retention, supported platform matrix, and release identity. Those approvals are not present in the canonical decision log.
- R1 additionally requires user-owned AWS/DNS/TLS/firewall/backup authority; R2 requires Windows hardware and signing/notarization identities. R3 fixture work is permitted only after R0, so it was not started out of order.
- No source, external account, credential, service, deployment, or third-party data was touched. Resume condition: record the R0 decisions and obtain explicit user approval, then execute its protocol-fixture and independent privacy/security review gate.

## 2026-08-03 — R0 local authority/protocol freeze

- Executor: primary implementation task. Reviewer: fresh independent context receiving the acceptance criteria and diff without builder rationale.
- Status: completed under the clarified authorization to select conservative local defaults. Scope: `implementation/R0_PROTOCOL_FREEZE_PLAN.md`; evidence: `implementation/R0_PROTOCOL_FREEZE_EVIDENCE.md`.
- The independent first pass found 3 high/3 medium issues; all were repaired. Final independent severity verdict: blocker 0, high 0, medium 0, low 0.
- Final gate: 35 suites / 179 tests, lint, build, zero-vulnerability high audit, native macOS package, packaged runtime closure, and diff-check pass.
- External stop remains: no AWS/Ubuntu deployment, public transport, Windows/signing environment, external credentials, accounts, or data.

## 2026-08-03 — R1 secure relay local preparation

- Executor: primary implementation task. Reviewer: fresh independent security/operations context.
- Status: local preparation completed; canonical hosted R1 remains at the explicit external authority gate. Scope: `implementation/R1_LOCAL_PREPARATION_PLAN.md`; evidence: `implementation/R1_LOCAL_PREPARATION_EVIDENCE.md`.
- Independent first pass found blocker 1, high 5, medium 5. Repairs and expanded fixtures produced a final clean verdict: blocker 0, high 0, medium 0, low 0.
- Final gate: 39 suites / 196 tests, lint, build, zero-vulnerability high audit, native macOS package, packaged runtime closure, and diff-check pass.
- External stop: no AWS resources, DNS, TLS identity, firewall, credentials, backup destination, public network, employer environment, or real two-peer claim without explicit user authority/access.

## 2026-08-03 — R1 hosted relay vertical slice

- Deployed the authenticated opaque relay to the approved shared Ubuntu VM behind a dedicated Caddy/TLS hostname without touching PostgreSQL or unrelated sites.
- Repaired native launch, signed-principal binding, proxy-aware rate isolation, authenticated backup encryption, exact retention, real health, TLS floor, and malformed-registry failure behavior through the Build to Complete review loop.
- Hosted transport evidence: real public TLS, two isolated same-Mac identities, bidirectional encryption, authorization/replay/revocation/epoch denial, restart persistence, and authenticated backup/restore.
- Independent hosted vertical-slice final verdict: clean, blocker 0 / high 0 / medium 0 / low 0. Final local gate: 41 suites / 201 tests, lint, build, zero-vulnerability audit, native macOS package, and runtime closure.
- Canonical R1 remains blocked on desktop enrollment/device/key lifecycle integration and the two-physical-Mac application sync matrix. Evidence: `implementation/R1_HOSTED_DEPLOYMENT_EVIDENCE.md`.

## 2026-08-03 — R1 desktop sync integration

- Implemented the native desktop enrollment, device/revocation, resumable rotation, signed relay pump, canonical convergence, replacement snapshot, and selective attachment-resume paths.
- Expanded the isolated peer matrix through conflicts, offline deletion, graph updates, re-enrollment, three-peer isolation, old-epoch drain, malicious snapshot rejection, outage recovery, and dropped attachment chunks.
- Repaired every blocker/high independent-review finding through repeated adversarial passes; terminal reviewer and deployment evidence are recorded in `implementation/R1_DESKTOP_SYNC_EVIDENCE.md`.
- Physical two-Mac validation and Windows-native verification remain honest hardware-contingent gates; they are not represented by the isolated same-Mac matrix.

## R3 Slice 1 — commitments and review-first memory (2026-08-03)

- Persisted the canonical promised-feature status audit and advanced past authority/hardware-bound R2 evidence to the next safe R3 slice without claiming Windows release readiness.
- Added deterministic local suggestions, exact provenance/digest validation, typed source-owned commitments, explicit accept/edit-and-accept/reject controls, completion state, migration 9, backup/restore support, and chat-first Knowledge integration.
- Independent review initially found two highs: stale/non-exact provenance and excessive main-process scan exposure. Repairs added atomic source validation and conservative lazy scan budgets; additional lifecycle/isolation fixtures and truthful terminal-action labeling were added before re-review.
- A second review found and drove repair of schema-8 pending-suggestion migration. Final independent verdict: blocker 0 / high 0 / medium 0 / low 1. Terminal gate: 49 suites / 235 tests, lint, build, zero production vulnerabilities, native macOS package, runtime closure, diff hygiene, and isolated-profile native launch.

## R3 Slice 2 — local daily briefing (2026-08-03)

- Added an explicit local briefing over open commitments and recent durable knowledge with source identity, freshness, why-included context, exact coverage, omissions, and per-local-day dismissal.
- Kept schedule/delivery and all external sources outside the slice. Bounded source excerpts and output, pruned expired dismissal metadata, workspace isolation, and source deletion cleanup preserve privacy and responsiveness.
- Focused timezone/DST, bounds, lifecycle, migration, isolation, and failure fixtures passed before the full package/review gate.
- Independent review drove repair of four highs and five mediums spanning timezone-stable dismissal, missing-source truthfulness, visible generation/source identity, replicated deletion cleanup, deterministic limits, validation, idempotency, and migration indexing. Final verdict: blocker 0 / high 0 / medium 1 / low 0; the medium is retained content-free historical day keys. Terminal gate: 51 suites / 245 tests, lint, build, zero production vulnerabilities, native macOS package/runtime closure, diff hygiene, and isolated-profile native launch.

## R3 Slice 3 — knowledge graph and learned rules (2026-08-03)

- Added navigable message-aware graph relationships and deterministic repeated-user-directive suggestions with exact multi-source provenance.
- Required current dry run and explicit approval; kept versioned workspace rules advisory with disable/re-enable/revert and content-minimized history. No authority, prompt, provider, schedule, sync, or external-action behavior is granted.
- Added schema 11, source-loss invalidation triggers, workspace isolation, deterministic bounds, backup/restore remapping, and chat-first Graph & rules UI.
- Independent review initially found three highs and two mediums in approved-rule invalidation, later-source merging, outcome expectations, graph endpoint visibility, and migration realism. All were repaired; final verdict: blocker 0 / high 0 / medium 0 / low 0.
- Terminal gate: 53 suites / 254 tests, lint, production build, zero production vulnerabilities, native macOS package/runtime closure, diff hygiene, and isolated-profile packaged launch.

## R3 Slice 4 — unified activity timeline (2026-08-03)

- Selected as the next safe ordered R3 slice after the knowledge graph/rules gate. Executor: primary task. Reviewer: fresh independent adversarial context supplied the acceptance criteria and implementation diff.
- Implemented a bounded workspace timeline projection, normalized event families, safe filtering, surviving-object navigation, deleted-target truthfulness, strict metadata minimization, and schema-12 activity indexing.
- External accounts, work data, scheduling, automation execution, audio recording, Windows hardware, signing, and two-instance validation remain outside this slice.
- Independent review initially found one high and three mediums. Repairs made sync audit writes non-interfering with revoke/rotation, covered the full bounded query window, added exact safe-target navigation, and eliminated token-shaped secret projection. Final verdict: blocker 0 / high 0 / medium 0 / low 0.
- Terminal gate: 56 suites / 259 tests, lint, production build, zero production vulnerabilities, native macOS package/runtime closure, diff hygiene, and isolated-profile packaged launch.

## R3 Slice 5 — local audio-only meetings (2026-08-03)

- Selected as the next safe ordered R3 slice. Executor: primary task. Reviewer: fresh independent privacy/lifecycle context supplied the acceptance criteria and diff.
- Implemented explicit-consent audio-only local capture, visible recording/stop state, strict duration/size/media/disk bounds, interruption reconciliation, playback/export, bounded manual transcript review, uncertain speakers, review-before-memory, backup/restore, and cascade deletion.
- A stalled local Whisper probe was terminated. No model download, external transcription, meeting sync, account data, scheduling, Windows claim, or two-instance validation was attempted.
- Independent review initially found five highs and three mediums; repairs closed sync leakage, crash residue, consent reuse, hidden controls, recorder failures, limit truthfulness, stale derived knowledge, and media integrity. A follow-up workspace-origin high was also repaired. Final verdict: blocker 0 / high 0 / medium 0 / low 0.
- Terminal gate: 59 suites / 268 tests, lint, production build, zero production vulnerabilities, native macOS package/runtime closure, microphone-purpose declaration, diff hygiene, and isolated-profile packaged launch.

## R4 Slice 1 — fixture connectors and paused playbooks (2026-08-03)

- Selected the first safe R4 slice after local meeting capture. External connectors, credentials, real data, webhook exposure, background scheduling, delivery, and model invocation remain gated.
- Implemented synthetic connector authority declarations, versioned paused playbooks, DST-aware next-run previews, mandatory dry runs, idempotent manual fixture execution, bounded retry/dead-letter behavior, kill/delete, content-minimized audit, backup/restore, and workspace isolation.
- Initial review found one high, two mediums, and one low. Repairs persisted and validated a canonical bounded definition, exposed per-playbook authority/version, made synthetic failure/retry reachable, and added archive-tamper/cascade tests.
- Reverification passed 61 suites / 273 tests, lint, production build, native arm64 macOS packaging, packaged runtime closure, diff hygiene, and isolated-profile native launch. Final independent verdict: clean pass, blocker 0 / high 0 / medium 0.

## R5 Slice 1 — local explainable provider routing (2026-08-03)

- R4 Outlook/calendar is blocked by explicit account/app-registration/tenant/data authority. Selected the next safe local R5 foundation without claiming the blocked connector gate.
- Implemented a deterministic signed-in CLI capability registry, explainable route proposals, attachment eligibility, fail-closed main-process enforcement, visible local route/profile, and fallback-off default.
- Initial review found one high and two mediums. Repairs unified displayed/submitted profile state with stale-response suppression, aligned attachment MIME/byte eligibility, and persisted/revalidated routed CLI version before spawn.
- Final verdict: clean, blocker 0 / high 0 / medium 0. Terminal gate: 62 suites / 276 tests, 39 focused reviewer tests, lint, build, zero vulnerabilities/undeclared licenses, native arm64 package, packaged runtime closure/launch, and diff hygiene.

## R5 Slice 2 — bounded local child tasks (2026-08-03)

- Implemented explicit typed child manifests, one-child/depth-one same-authority enforcement, bounded parent-result context, 60-second runtime, durable task lineage, and parent cancellation propagation.
- Initial review found three highs and two mediums: Codex tools were not disabled, parent output was absent, queued cancellation raced spawn, non-completed roots were eligible, and integration coverage was weak. Repairs restricted children to reviewed no-tools Claude, required completed text output, labeled/bounded parent context, terminalized queued children, rechecked queued state after detection, aligned UI, and added tests.
- Follow-up review found a medium canonical-output mismatch and a low recovery-coverage gap. Repairs shared Claude terminal-frame selection with durable finalization and proved backup/restore remaps lineage, preserves typed provenance, and interrupts queued authority.
- Final independent verdict: clean, blocker 0 / high 0 / medium 0 / low 0. Terminal gate: 63 suites / 278 tests, lint, build, zero vulnerabilities/undeclared licenses, native arm64 package, packaged runtime closure/launch, and diff hygiene.

## R5 Slice 3 — local embedding and chunking benchmark (2026-08-03)

- Selected after bounded child tasks because the canonical R5 order next requires the swappable embedding/chunking benchmark and future peer-worker policy seam. Executor: primary task; reviewer: fresh independent adversarial context.
- Acceptance and boundaries are frozen in `implementation/R5_EMBEDDING_BENCHMARK_PLAN.md`. No downloads, external calls, API credentials, peer execution, or live-index mutation are authorized.
- Local automated evidence currently recommends Qwen3-Embedding 4B over BGE-M3 on the representative suite; Qwen 8B is unavailable and no model was pulled. Focused 30-test, lint, and build gate passed; independent review is in progress.
- Initial independent review returned no-ship with three highs, three mediums, and one low. Repairs now enforce quality/measured-memory thresholds, canonical provider/model registration, strict batching/resource caps, disabled peer authority, single suite provenance, and bounded two-generation live-index rollback. Follow-up review is in progress.
- Follow-up retained one high and one medium in hybrid-memory accounting and generic-provider timeout. Repairs use total loaded Ollama memory and a whole-benchmark deadline; focused 34-test, lint, build, and diff gate passes. Final review is in progress.
- Final independent verdict: ship, blocker 0 / high 0 / medium 0 / low 0. Terminal gate: 64 suites / 288 tests, lint, build, zero high vulnerabilities/undeclared licenses, production SBOM, native arm64 package/runtime closure/launch, and diff hygiene.

## R5 Slice 4 — conservative local execution budgets (2026-08-03)

- Selected as the next safe R5 slice because it completes finite budget, approval, and recovery visibility for existing local runs without making gated policy choices or widening authority. Executor: primary task; reviewer: fresh independent adversarial context.
- Acceptance is frozen in `implementation/R5_EXECUTION_BUDGETS_PLAN.md`. Focused 3-file / 32-test, lint, and build gate passes; independent review is in progress.
- Initial review returned no-ship with one high, one medium, and one low. Repairs make receipts mandatory, validate and bind the exact budget/profile/lineage contract, fail closed on profile widening, and cover child restore. Follow-up review is in progress.
- Follow-up retained one duration-binding high. Repairs now bind duration exactly to effective profile plus root/child cap and reject widened/mismatched receipts; final review is in progress.
- Final independent verdict: ship, blocker 0 / high 0 / medium 0 / low 0. Terminal gate: 65 suites / 292 tests, lint, build, zero high vulnerabilities/undeclared licenses, production SBOM, native arm64 package/runtime closure/launch, and diff hygiene.

## Post-MVP health — local backup administration (2026-08-03)

- Recorded the remaining R5 policy/device and R6 mobile/platform authority gates, then selected the next safe local health feature.
- Froze acceptance in `implementation/HEALTH_BACKUP_ADMIN_PLAN.md` and implemented read-only backup inspection plus an isolated production-path restore drill.
- Self-review caught a verification side effect from adjacent-file crash recovery; inspection now uses a dedicated read-only path. Artifact digest and timestamp checks were strengthened before independent review.
- Independent review initially found two highs, two mediums, and one low. Repairs cover all 21 restored families with the expected restore activity delta, independently guarantee removal attempts after close failure, validate timestamp ordering, and clean test fixtures.
- Final verdict: gate clean, blocker 0 / high 0 / medium 1 / low 1. Accepted medium is temporary UI blocking for explicit large local archives; accepted low is direct meeting-audio/removal-failure branch coverage. Terminal gate: 66 suites / 299 tests, lint, build, dependency/SBOM checks, native arm64 package/runtime closure/launch, and diff hygiene.

## Post-MVP health — responsive backup administration (2026-08-03)

- Selected as the next safe local slice after recording external/account/device/policy gates. Executor: primary task; reviewer: fresh independent context after focused verification.
- Acceptance frozen in `implementation/HEALTH_BACKUP_RESPONSIVENESS_PLAN.md`; implemented one-at-a-time worker execution with strict result reconstruction and compiled/package worker proofs.
- Initial review found two highs, two mediums, and one low. Repairs added parent-owned drill cleanup, bounded hang termination, slot retention through clean exit/cleanup, and a repeatable compiled-worker gate.
- Final verdict: gate clean, blocker 0 / high 0 / medium 0 / low 1. Terminal gate: 67 suites / 303 tests, lint/build, dependency/SBOM checks, compiled and packaged worker verify/drill/cleanup, native arm64 package/runtime closure/launch, and diff hygiene.

## Production local document ingestion and chunking (2026-08-03)

- Selected as the next substantive safe local phase. Acceptance frozen in `implementation/LOCAL_DOCUMENT_INGESTION_PLAN.md` and terminal evidence recorded in `implementation/LOCAL_DOCUMENT_INGESTION_EVIDENCE.md`.
- Recorded the next two safe streams: local trigger/webhook simulation, then capability-gated local voice chat. Neither authorizes public ingress, unattended actions, cloud voice, or model downloads.
- Independent review initially found four highs, three mediums, and one low. Repairs bounded/concurrency-guarded indexing, prohibited mixed model digests, separated truthful failure states, bound/re-extracted original-source provenance, hardened worker messages, and revalidated provenance through backup/restore/drills/diagnostics. Final verdict: ship, blocker 0 / high 0 / medium 1 / low 1.
- Terminal gate: 69 suites / 313 tests, lint/build, zero vulnerabilities/undeclared licenses, SBOM, compiled and packaged worker proof, native arm64 package/runtime closure, isolated-profile packaged launch, and diff hygiene.

## P1 — local proactive triggers and webhook lab (2026-08-03)

- Selected after the document gate and separately committed roadmap addendum. Acceptance frozen in `implementation/LOCAL_TRIGGER_WEBHOOK_LAB_PLAN.md`.
- Scope is local synthetic event/rule simulation only. Public ingress, schedules, accounts, network calls, external data/actions, models, and unattended activation remain unavailable.
- Implemented quarantined fixture events, suggested/paused rules, deterministic zero-effect dry runs, bounded retry/dead-letter history, kill/delete controls, workspace isolation, schema migration, backup/restore, and chat-first Automations UI.
- Independent review drove repair of stored event/rule/run provenance, payload authority/shape validation, canonical event grammar, retry/success idempotency, terminal dead letters, and a real schema-15 migration test. Final verdict: ship, blocker 0 / high 0 / medium 0 / low 0.
- Terminal gate: 71 suites / 326 tests, lint/build, zero high dependency vulnerabilities, native arm64 package/runtime closure, diff hygiene, and isolated-profile native launch.

## Production signed inbound webhook — vertical slice (2026-08-03)

- User explicitly authorized a real inbound path on the existing dedicated relay origin. Acceptance is frozen in `implementation/PRODUCTION_INBOUND_WEBHOOK_PLAN.md`.
- Survey: existing Caddy/TLS and loopback relay are healthy, Caddy validates, PostgreSQL remains untouched, and no DNS/firewall/new resource is required. Planned live mutation is limited to a versioned relay release, dedicated protected webhook key/config, relay SQLite migration, and restart of only `waypoint-relay.service` after verified backup.
- Implemented owner-only channel lifecycle, one-time protected signing secrets, timestamp/nonce replay defense, opaque sealed event intake, authenticated pull/ack, local quarantine/decryption, kill/delete, bounded retention/quotas, backup/restore, and schema-v17 source provenance.
- Independent review drove two repair rounds across authorization, retention, duplicate identity, expiry, AES-GCM AAD, key recovery, backup provenance, and future-time bounds. Final verdict: SHIP, blocker 0 / high 0 / medium 0 / low 0.
- Terminal local gate: 73 suites / 333 tests, lint/build, zero dependency vulnerabilities, SBOM, native arm64 package/runtime closure, and diff hygiene.
- Hosted gate passed at the existing dedicated TLS endpoint: encrypted pre-migration backup, protected paired webhook key recovery, versioned release, relay-only restart, signed/replay/rotation/kill/delete tests, restart persistence, outage/recovery, exact synthetic cleanup, empty production registry, zero queued webhook data, and SQLite integrity `ok`. Caddy/PostgreSQL remained active and unchanged.

## P6B — Generic Tool Gateway vertical slice (2026-08-03)

- User selected P6B ahead of the remaining safe-local sequence. Acceptance is frozen in `implementation/P6B_TOOL_GATEWAY_PLAN.md`; no external account, provider, browser, peer, PR, deployment, or service authority is implied.
- Built the trusted-main tool contract, workspace file reads, interactive terminal/local-CLI adapter, domain-only AI bridge, minimized durable receipts, UI status surface, and structured Codex/Claude in-chat timeline.
- Initial adversarial review returned NO-SHIP (1 blocker/5 high). The repair denied AI-origin inherited process execution, made tool dispatch fail closed, added dominant POSIX process-tree cancellation, reassembled output before redaction, workspace-scoped progress, terminal exception receipts, per-workspace concurrency, strict timeouts, and Claude tool-result normalization.
- Fresh re-review returned SHIP (0 blocker/0 high; 3 medium/1 low). Full gate passed 74 files/344 tests, lint, build, dependency/SBOM checks, macOS package/runtime closure, isolated native launch, and diff check. Evidence: `implementation/P6B_TOOL_GATEWAY_EVIDENCE.md`.

## P6C — Tool Failure Learning / Prevention (2026-08-03)

- User authorized the local P6C vertical slice. Acceptance is frozen in `implementation/P6C_TOOL_FAILURE_LEARNING_PLAN.md`; no hosted provider, external account/service, browser, peer execution, unrestricted AI terminal, or deployment authority is implied.
- Built v19 failure knowledge, protected HMAC identities, gateway preflight/reasoned retry, success supersession, bounded purge, backup/sync lifecycle, strict provenance validation, and a readable settings view.
- Initial independent review returned NO-SHIP (0 blocker/3 high/2 medium). Repairs made enrolled-peer keys portable with epoch provenance, journaled expired/overflow deletion, executed-only learning, policy-secret note redaction, and strict archive/inbound validation.
- First re-review returned SHIP (0 blocker/0 high/2 medium/1 low). Source receipt semantics, canonical ISO enforcement, and deterministic equal-time pruning were repaired before the final review.
- A final spot-check caught missing supersession provenance in replacement snapshots. Incremental and full snapshot serialization now share one minimized payload builder; a new regression proves superseded snapshot recovery without raw command content. Final review: SHIP (0 blocker/0 high/0 medium/0 low).
- Terminal gate passed 75 files/352 tests, lint, build, dependency verification/SBOM, macOS arm64 package/runtime closure, isolated native launch, and diff check. Evidence: `implementation/P6C_TOOL_FAILURE_LEARNING_EVIDENCE.md`.
- Executor: primary task. Reviewer: fresh independent adversarial context after targeted verification.

## P6D — OpenRouter provider integration (2026-08-03)

- Implemented protected, explicitly activated OpenRouter routing with model preferences, budget/cost observability, subscription fallback, hosted chat provenance, cancellation, lifecycle, backup, and sync.
- Initial review found 1 blocker/4 high; production chat wiring, atomic reservation, incremental sync, bounded response handling, and keyed prompt provenance were repaired. Re-review exposed replacement-sync and hard-cap gaps; final repairs added targeted full snapshots, provider token/max-price controls, and authoritative over-cap accounting.
- Final review: SHIP (0 blocker/0 high/2 medium/0 low). Full gate: 78 files/365 tests, lint/build, dependency audit, macOS package/runtime closure, and diff hygiene. No live provider call or key use occurred.
