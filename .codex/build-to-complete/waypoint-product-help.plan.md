# Waypoint Product Help phase

## Objective

Ship a versioned, local, bundled Help library that lets a user ask the normal Waypoint chat how the app works. Retrieve only relevant pages, require visible Help citations, and keep the library current through the normal build gate.

## Acceptance gate

- A reviewed Help catalog covers onboarding/chat, knowledge, models, voice/meetings, tools/browser/web, manual capture, sync/backup/devices, and privacy/troubleshooting.
- Help is generated deterministically from repository sources, hashed in a manifest, bundled in macOS/Windows packages, and loaded only after path, size, UTF-8, and digest validation.
- Root Codex, Claude, and configured OpenRouter chats receive at most three relevant pages for a Waypoint-help question. Unrelated prompts and delegated child tasks receive none.
- The context labels Help as untrusted reference data with no authority and instructs the model to cite `[Waypoint Help: Page title]`, state uncertainty, and never invent a capability.
- A visible, bounded execution receipt identifies the Help pages used without exposing the prompt or workspace content.
- Feature-facing source changes fail the normal Help preparation gate unless the Help catalog or source pages are reviewed in the same change.
- Focused tests cover intent, ranking, bounds, tampering, traversal, stale manifests, route composition, and freshness enforcement.
- Pinned full tests, zero-warning lint, build, package/runtime closure, packaged macOS inspection, and an independent severity-rated review pass with no unresolved blocker/high.

## Explicit boundaries

- Help files are immutable application resources, not workspace documents. They are not backed up, synced, relayed, indexed with personal data, or editable by a provider.
- Help retrieval is deterministic and local. It makes no network call and adds no tool, account, or filesystem authority.
- Windows package configuration is implemented; native Windows package inspection remains platform-contingent.
