# Waypoint execution timeline

## Controls

- Scope source: the approved planning set in `outputs/`.
- Security profile: workspace-only writes, no secrets, read-only CLI capability probes, no remote service invocation.
- Stop control: the user may stop work at any time; no phase advances without a clean gate.
- Prohibited without follow-up authorization: deploy, publish, commit, or external integration.
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

## Later phases

Phases 1–4 retain the gates in `outputs/ROADMAP.md`. Their detailed evidence will be added only when each phase begins.

## Current gate

Current-Mac embedding/provider evidence passes with Ollama+Qwen3-Embedding 4B as the quality-first suite-v2 default and BGE-M3 as the lighter fallback. Final independent review found no blocker/high finding.

Windows-native build/package/launch, filesystem, update-path, and child-process validation is required immediately when the project moves to Windows, by explicit user decision.
