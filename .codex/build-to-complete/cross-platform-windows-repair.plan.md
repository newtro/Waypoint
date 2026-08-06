# Cross-Platform Windows Repair Plan

## Goal

Make a clean checkout install, build, test, package, and launch on Windows without weakening or breaking the existing macOS build and security/durability boundaries.

## Phase 1 — Reproducible cross-platform install and build

- Align the declared Node/npm toolchain with direct dependency requirements.
- Regenerate a portable lockfile that passes `npm ci` on Windows.
- Adopt npm's current default-deny install-script policy with a version-pinned allowlist, and reject Git/remote URL dependencies.
- Check the complete resolved dependency tree against npm/GitHub advisories and known recent compromised releases.
- Replace shell-specific build operations with cross-platform Node tooling.
- Protect checksum-verified vendored assets from checkout line-ending conversion.
- Gate: clean policy-enforced `npm ci`, zero known vulnerabilities/malware matches, lint, TypeScript/Vite build, and focused asset-preparation checks.

## Phase 2 — Windows filesystem correctness and tests

- Make durable file and directory synchronization behave correctly on Windows while preserving macOS durability semantics.
- Keep symlink/path-escape security tests meaningful on platforms without unprivileged file symlink creation.
- Remove hard-coded POSIX path and line-ending assumptions from tests or production serialization as appropriate.
- Gate: complete unit test suite, lint, and build pass on Windows with no weakened authority checks.

## Phase 3 — Windows package and macOS regression protection

- Prepare native voice and browser assets, assemble the Windows Electron directory package, and prove it launches.
- Verify packaged resource closure and important runtime startup behavior on Windows.
- Verify the macOS target, resources, scripts, and platform branches remain valid through static/configuration tests available on Windows.
- Gate: clean Windows package, runtime smoke evidence, full lint/test/build/package gate, and macOS regression inspection.

## Final gate

- Two independent whole-project adversarial reviews must report no valid BLOCKER or MAJOR findings.
- The worktree must contain only intentional source/plan changes and no generated platform residue.
