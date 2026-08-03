# R5 Slice 1 — local explainable provider routing

## Scope

Add a deterministic, local-only policy layer around the already-authorized Codex and Claude Code CLIs. It proposes and validates a route; it does not add providers, accounts, APIs, peer execution, costs, unattended fallback, or broader agent authority.

## Acceptance gate

1. A versioned registry declares provider, execution device, privacy/cost class, accepted attachment media, and CLI health/version.
2. A deterministic proposal explains selection, ineligible providers, attachment delivery/local-only outcomes, security profile, and fallback policy.
3. User override is explicit but cannot select an unavailable/incompatible provider or bypass workspace/profile/device constraints.
4. Fallback defaults off. An opt-in fallback order never changes device, network, profile, workspace, privacy, or cost boundary.
5. No eligible route fails before execution is created. Stale/missing/incompatible CLIs and unsupported attachment types are covered.
6. Existing execution records retain selected provider/version/device/profile/model and content-minimized activity; cancel/retry semantics do not change.
7. Full tests, lint, production build, native macOS package/runtime launch, dependency audit, independent review, and repair/reverification pass.

## Explicit exclusions

No API keys/providers, model downloads, external calls, peer execution, recursive agents, unattended fallback, connector data, real accounts, scheduling, delivery, Windows claim, signing, or publishing.

