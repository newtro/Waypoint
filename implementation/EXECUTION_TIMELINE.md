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
