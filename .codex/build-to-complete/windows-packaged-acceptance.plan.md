# Windows Packaged Acceptance and Repair Plan

## Phase 1 — Repair blocking Windows runtime defects

- Make Codex CLI discovery and version probing work with Windows npm command shims without changing native executable or macOS/Linux execution behavior.
- Ensure every newly created workspace immediately receives the security profiles required by the tool gateway, while preserving constructor-time backfill for older workspaces.
- Add regression coverage for Windows command-shim execution and fresh-workspace profile availability.

## Phase 2 — Package and conduct real Windows acceptance

- Run the relevant full build, lint, test, dependency, and package-runtime gates with the repository-required Node/npm toolchain.
- Produce a fresh Windows packaged directory from current `main`.
- Exercise the actual packaged UI with its normal Electron profile as a user would, using disposable QA workspaces and files only.
- Test both Codex and Claude local CLI routes, including response, streaming, cancellation, failure, and reopen where reachable.
- Cover restart/window persistence, workspace lifecycle, Knowledge and durable memory, imports, browser/tool readiness, voice readiness without microphone recording, rollups, and truthful unavailable cross-device gates.
- Capture Pass, Fail, or Unavailable evidence and distinguish defects from missing configuration.

## Phase 3 — Repair, retest, and final verification

- Fix every valid blocking or major defect found in Phase 2, batching non-blocking repairs when practical.
- Rebuild and repeat affected packaged-runtime acceptance flows.
- Run the full project verification gate and independent adversarial reviews.
- Preserve macOS packaging, signing, ARM64 resources, browser paths, and runtime branches through static inspection and tests; do not claim an executed macOS package run from Windows.
