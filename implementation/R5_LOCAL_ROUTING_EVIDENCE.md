# R5 Slice 1 — local explainable routing evidence

## Outcome

Waypoint now evaluates a versioned, deterministic route before creating an execution. The registry is limited to the existing signed-in Codex and Claude Code CLIs on the local device. The composer displays selected provider, local device/privacy class, profile, and the default no-fallback policy.

The main process independently recomputes and enforces the route using current CLI health, exact workspace/profile, and attachment metadata. Missing or incompatible preferred CLIs fail before execution creation. Unsupported files remain local and are reported per provider.

## Boundary

- No APIs, credentials, external network calls, peer execution, cost-bearing providers, model downloads, connectors, unattended fallback, or expanded agent authority.
- Fallback is disabled in chat execution. The pure policy supports an explicit opt-in proposal only within the same local signed-in-CLI privacy/cost/device/profile class; no UI activates it.
- Existing execution provenance retains provider, detected CLI version, device, profile, model, lineage, and prompt digest without duplicating prompt content.

## Verification

- Full suite: 62 files / 276 tests passed.
- Focused routing/workbench/attachment suite: 18 tests passed.
- ESLint, TypeScript, preload build, and Vite production build passed.
- Dependency audit: zero vulnerabilities; 499 packages, zero undeclared licenses.
- arm64 macOS directory package and packaged runtime import closure passed; unsigned as expected.
- Native packaged executable launched with an isolated local user-data directory and exited cleanly.

## Independent review and repair

Initial review found one high (the displayed profile could differ from the submitted profile) and two mediums (attachment size was absent from eligibility, and routed CLI version was not durable at queue time). Repairs made profile selection controlled and race-safe, aligned proposal MIME/byte bounds with execution preparation, persisted the routed CLI version before spawn, rejected second-detection version drift, and recorded content-minimized policy-version provenance. Final independent verdict: clean, blocker 0 / high 0 / medium 0; 39 focused tests passed.
