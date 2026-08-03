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
