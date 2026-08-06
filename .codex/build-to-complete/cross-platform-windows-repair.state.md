# Build to Complete State: Cross-Platform Windows Repair

- Source: D:\Repos\Waypoint\.codex\build-to-complete\cross-platform-windows-repair.plan.md
- Repository: D:\Repos\Waypoint
- Branch: main
- Started: 2026-08-04T17:44:54.6081674-04:00
- Updated: 2026-08-04T18:14:30-04:00
- Baseline worktree: clean at 193e44a9365989d38452ee169778a7cd6a8768eb after fast-forward pull
- Current phase: final whole-project gate
- Overall status: COMPLETE
- Build status: PASSING
- Confidence: HIGH

## Phase ledger

### Phase 1 — Reproducible cross-platform install and build

- Status: CLEAN
- Tasks: 5/5
- Fix cycles: 1/4
- Review cycles: 2
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

##### Task 1.1 — Align supported toolchain

- Outcome: project and direct dependencies agree on a supported Node/npm version on Windows and macOS.
- Non-goals: dependency feature upgrades unrelated to compatibility.
- Files/subsystems: package.json, package-lock.json, .nvmrc, README.md.
- Artifacts: portable dependency lock and documented version contract.
- Integration path: clean checkout -> version manager -> npm ci.
- Automated proof: engine-clean npm ci and dependency tree inspection.
- Runtime proof: subsequent build/package phases use the declared toolchain.
- Visual/manual proof: none.
- Decisions/external inputs: none expected.

##### Task 1.2 — Make build command cross-platform

- Outcome: npm run build executes unchanged on Windows and macOS.
- Non-goals: changing emitted application behavior.
- Files/subsystems: package scripts and build helper.
- Artifacts: dist and dist-electron output.
- Integration path: npm run build.
- Automated proof: clean build on Windows plus focused helper test/inspection.
- Runtime proof: packaged main process consumes the copied preload artifact.
- Visual/manual proof: deferred to Phase 3.
- Decisions/external inputs: none.

##### Task 1.3 — Preserve checksum-protected assets

- Outcome: Git checkout does not rewrite bytes covered by source manifests.
- Non-goals: changing model or voice data.
- Files/subsystems: .gitattributes and vendored source manifests.
- Artifacts: byte-identical source assets and prepared staging tree.
- Integration path: checkout -> prepare:fast-voice.
- Automated proof: manifest verification and preparation pass on Windows.
- Runtime proof: deferred to packaged voice probe.
- Visual/manual proof: none.
- Decisions/external inputs: none.

##### Task 1.4 — Phase gate

- Outcome: clean install, lint, build, and asset preparation all pass.
- Non-goals: resolving platform-specific unit behavior reserved for Phase 2.
- Files/subsystems: entire dependency/build surface.
- Artifacts: command logs and clean tracked diff.
- Integration path: documented README build flow.
- Automated proof: npm ci; npm run lint; npm run build; npm run prepare:fast-voice; npm run prepare:agent-browser.
- Runtime proof: build artifacts inspected and used in Phase 3.
- Visual/manual proof: none.
- Decisions/external inputs: none.

##### Task 1.5 — Supply-chain security gate

- Outcome: no resolved package/version is identified as malicious or vulnerable, and only reviewed version-pinned dependency scripts may execute during install.
- Non-goals: asserting that any third-party package can never be compromised in the future.
- Files/subsystems: package.json, package-lock.json, .npmrc, complete dependency graph.
- Artifacts: install-script allowlist, audit output, dependency/version incident comparison, and URL/provenance inspection.
- Integration path: clean checkout -> policy-enforced npm ci -> audit/security verification.
- Automated proof: npm audit; pending-script check; lockfile scan for Git/remote dependencies and known compromised releases; dependency tree validation.
- Runtime proof: required approved native/tooling packages install and package successfully under the restricted policy.
- Visual/manual proof: none.
- Decisions/external inputs: newly disclosed advisories may require dependency replacement.

#### Task evidence

- [x] Task 1.1 — DONE
  - Evidence: Node 24.15.0/npm 12.0.1 exact engine contract; regenerated 8,897-line lock; `npm ci` installed 563 packages with zero vulnerabilities.
- [x] Task 1.2 — DONE
  - Evidence: `npm run build` passes using scripts/copy-preload.mjs; TypeScript/preload/Vite outputs generated.
- [x] Task 1.3 — DONE
  - Evidence: .gitattributes preserves exact vendor bytes; `npm run prepare:fast-voice` passes; platform-specific reviewed browser digests prepare without rewriting source.
- [x] Task 1.4 — DONE
  - Evidence: fresh `npm ci`, lint, build, prepare:fast-voice, and prepare:agent-browser all exit 0 on Windows.
- [x] Task 1.5 — DONE
  - Evidence: npm audit reports 0 at all severities; 563/563 registry signatures verify; 124 attestations verify; policy covers 5 exact install-script packages; no Git/remote dependencies; 28,417 GitHub malware advisories semver-matched against 566 installed package names with 0 matches.

#### Review log

- Review 1: ISSUES_FOUND — 3 MAJOR: incorrect Windows Chromium manifest path, npm 11 policy bypass, and non-durable malware-feed verification.
- Fix cycle 1: corrected and self-verified the copied Chromium path; added engine-strict, devEngines, and an install preflight; documented npm ci; added a fail-closed live OSV query for all 627 resolved entries to verify:dependencies.
- Review 2: dispatched with fresh context.
- Review 2: CLEAN — prior findings reproduced as fixed; all Phase 1 acceptance evidence passed.

### Phase 2 — Windows filesystem correctness and tests

- Status: CLEAN
- Tasks: 3/3
- Fix cycles: 1/4
- Review cycles: 2
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

- Durable backup/vault writes pass on Windows without weakening macOS fsync behavior.
- Security tests exercise path/symlink escape protection using platform-capable primitives.
- All platform-sensitive tests use intentional path/newline semantics.
- Automated proof: complete npm test, lint, and build pass.

#### Task evidence

- [x] Durable writes — shared file/directory sync preserves macOS fsync and uses Windows-writable file handles while narrowly tolerating unsupported Windows directory fsync.
- [x] Platform security fixtures — junction-capable escape tests pass without requiring Windows Developer Mode; voice runtime rejects linked path components.
- [x] Portable test semantics — child URLs use fileURLToPath, workbench paths use node:path, and POSIX modes are asserted only where meaningful.
- [x] Phase gate — focused 65/65 tests and full 477/477 tests pass; lint and production build pass.

#### Review log

- Review 1: ISSUES_FOUND — 1 MAJOR: custom backup directory parsing treated a Windows drive root as drive-relative.
- Fix cycle 1: replaced parsing and candidate concatenation with path.dirname, path.basename, and path.join; backup/crash/admin tests 16/16, lint, and build pass.
- Review 2: CLEAN — 65/65 focused and 477/477 full tests, lint, and build passed; durability and junction defenses verified.

### Phase 3 — Windows package and macOS regression protection

- Status: CLEAN
- Tasks: 3/3
- Fix cycles: 0/4
- Review cycles: 0
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

- Windows Electron directory package assembles with verified resources and launches from the packaged executable.
- Packaged startup produces no immediate fatal error and the main UI becomes reachable.
- macOS target/resource configuration and platform-specific runtime branches remain intact and covered by available tests/static inspection.
- Automated proof: package:dir plus full lint/test/build gate and configuration checks.
- Runtime proof: launch packaged Waypoint.exe, observe window/process, then close it cleanly.

#### Task evidence

- [x] Windows package — `npm run package:dir` produced release/win-unpacked with app.asar, cross-platform voice assets, and the reviewed Windows Agent Browser closure.
- [x] Packaged closure — `npm run verify:package-runtime` validates normalized Windows ASAR imports, Agent Browser integrity, Fast Local hashes/provenance, native Sherpa load, TTS latency, and ASR initialization.
- [x] Runtime UI — packaged Waypoint.exe launched as a clean process; Windows UI capture showed the complete onboarding form and accessibility tree; Alt+F4 closed it with no lingering process.
- [x] macOS protection — existing macOS target, codesign branch, ARM64 digest, voice resource verification, and Mac executable probing remain present; package verifier selects platform paths explicitly.

#### Review log

- Review 1: dispatched with fresh context.
- Review 1: CLEAN — package, closure, real UI, contents, Electron isolation, Windows native resources, and retained macOS branches verified.

## Final whole-project gate

- Status: CLEAN
- Final gate: clean npm ci; audit/signatures/attestations/policy/live OSV; 480/480 tests; lint; package:dir; packaged runtime/resource closure; final packaged UI launch and clean exit.
- Review cycle 1: 2 MAJOR findings across reviewers — runtime closure omitted preload/dynamic/computed workers; browser trust admitted unlisted files.
- Fix cycle 1: added explicit runtime roots and import-meta URL traversal with regression tests; enumerated the full Agent Browser tree and rejected additions.
- Review cycle 2: 1 MAJOR — browserExecutable target was not bound to reviewed trust.
- Fix cycle 2: static trust now binds exact platform digest and browser executable path; preparation and runtime both enforce them.
- Review cycle 3: dynamic import and relative require traversal added after one reviewer exposed the remaining graph gap.
- Review cycle 4: two fresh independent whole-project reviewers returned CLEAN with no BLOCKER, MAJOR, or MINOR findings.

## Deferred MINOR findings

- None.

## Blockers

- Initial known failures: npm ci AIX package error, Unix cp in build, CRLF-corrupted manifest assets, and 23 Windows unit test failures.
