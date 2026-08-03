# Phase 0 verification evidence

## Environment

- macOS 26.5.1, Apple Silicon arm64.
- Node 22.16.0 and npm 10.9.2.
- Electron 43.2.0.
- Codex CLI detected at version `0.146.0-alpha.9.2`.
- Claude Code was initially detected at version `2.1.71` and updated through its official `claude update` path to `2.1.220`.
- Native workflow; Docker was not used and is not required.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Unit tests | Pass | Vitest: 5 files, 32 tests. |
| Lint | Pass | ESLint completed with no findings. |
| Type/build | Pass | TypeScript project build and Vite production build completed. |
| CLI detection | Pass | Both installed CLIs returned structured executable/version state via `--version` only. |
| Local vector mechanics | Pass with explicit limitation | 10,000 384-dimensional deterministic vectors generated in 67 ms (~148k docs/sec); this is not semantic-quality evidence. |
| Sync/deletion model | Pass | Deterministic concurrent-write ordering and tombstone anti-resurrection tests pass. |
| Native package | Pass | electron-builder created `release/mac-arm64/Waypoint.app`; signing intentionally skipped for local development. |
| Codex live stream | Pass | Ephemeral, read-only JSONL run emitted thread/turn events, exact response, completion, and usage; a separate run canceled with exit code 1 before content. |
| Claude auth/live stream | Pass | Version 2.1.71 stalled after initialization. Official update to 2.1.220 exposed an expired OAuth session; after user reauthentication, a bounded tool-free/non-persistent run emitted partial stream events, exact final text, terminal `completed`, and exit 0. No credential values were recorded. |
| Claude failure path | Pass | Invalid model selection emitted structured `model_not_found` assistant/result events, terminal API error, and exit 1 without tool access or workspace writes. |
| Claude cancellation | Pass | Interrupting an active no-tools stream emitted partial events, a user-interrupted event, terminal `aborted_streaming`, and a bounded process exit without workspace writes. |
| Real local embedding candidate | Feasible but rejected | `Xenova/all-MiniLM-L6-v2` q8 via `@huggingface/transformers`: 2.2 s cold load, 8 ms for four texts, 384 dimensions, +129 MiB RSS, 23 MiB model on this Mac. The candidate dependency was removed after npm audit reported four high vulnerabilities with no fix. |
| Ollama BGE-M3 | Pass / lighter fallback | Suite v2: 1.16 GB, 1024d, MIT, .96 s cold, 70 docs/s, 349 ms/24-query batch; R@1 .833, R@3 .958, MRR .906. |
| Ollama Qwen3-Embedding 4B | Pass / quality-first default | Suite v2: 2.50 GB, 2560d, Apache-2.0, .92 s cold, 20 docs/s, 1.19 s/24-query batch; R@1 .833, R@3 1.0, MRR .917. |
| Swappable provider/provenance | Pass | Automated isolated harness records provider/runtime version, model, digest, dimensions, suite version and metrics; tests cover embedding/chunking reindex triggers and trusted-peer routing/fallback policy. |
| Dependency audit after removal | Pass | `npm audit`: 0 vulnerabilities. |

## Failures found and repaired during verification

1. Malformed `rootDir` and missing Vite CSS types prevented type/test transforms; corrected config and re-ran all checks.
2. Electron was incorrectly listed as a runtime dependency; moved it to development dependencies as required by the packager.
3. Package entry path did not match TypeScript output; aligned it to `dist-electron/electron/main.js` and packaging passed.
4. Initial sync model silently selected one concurrent body and ignored object identity; replaced with vector-clock conflict preservation, tombstone dominance, replay, and identity-isolation tests.
5. Initial CLI lookup used a POSIX shell and re-resolved the binary; replaced with native PATH/PATHEXT resolution and exact-path execution tests.
6. A real local embedding runtime was feasible on this Mac but introduced four unpatched high-severity dependency advisories; it was rejected and removed.
7. Re-review found the Windows resolver still used the host path delimiter; it now selects `path.win32`/`path.posix` explicitly and asserts the exact Windows path.

## Gate limitations

- Windows-native packaging, launch, update path, filesystem behavior, and child-process supervision cannot be claimed from this macOS host. By explicit user decision, these checks are mandatory when the project moves to Windows and do not block current Mac phases.
- Code signing/notarization is deliberately deferred to release hardening.
- BGE-M3 and Qwen3-Embedding 4B pass current-Mac product-suite v2 evaluation; Windows/oldest-hardware performance remains platform/hardware-contingent and future suites must grow before claiming broad quality equivalence.
- The sync model proves invariants, not transport, encryption, persistence, or multi-peer integration.
- Claude 2.1.220 completion, structured failure, and streaming cancellation pass after user OAuth reauthentication.

## Review

Earlier adversarial reviews found and verified repairs for unsafe CLI lookup, conflict data loss/object identity, missing threat model, Claude stream behavior, embedding metric validity, loopback privacy enforcement, and model licensing/reproducibility. Windows-only checks are platform-contingent by user decision. Final independent review found no blocker or high-severity finding.
