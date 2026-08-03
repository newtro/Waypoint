# R4 Slice 1 — fixture automations evidence

## Outcome

Waypoint now has a local-only fixture connector and versioned playbook lab. It exercises timezone-aware schedule previews, immutable read-only authority snapshots, deterministic dry runs, manual idempotent execution, bounded retries/dead-lettering, kill switches, local audit history, backup/restore, and hard deletion without enabling unattended schedules or any external connector.

## Safety boundary

- Provider/account/tenant: `fixture.local` / `synthetic-personal` / `local-fixture`.
- Capability: `fixture.read` only; draft, write, network, and token references are false.
- Fixture bodies are untrusted inputs and are not copied into permissions, audit details, or sync mutations.
- Every playbook is created paused. Schedule activation is deliberately unavailable and throws a truthful authorization error.
- Restores recompute definition provenance, clear dry-run authority and idempotency keys, and therefore require a new dry run before execution.
- Playbooks and runs stay device-local and workspace-scoped; deletion cascades run history.

## Verification

- `npm test -- --run`: 61 files, 273 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run package:dir`: arm64 macOS app packaged successfully (unsigned, as expected without a signing identity).
- `npm run verify:package-runtime`: packaged ASAR import closure passed.
- Native packaged executable launched with an isolated temporary user-data directory and exited cleanly.
- `git diff --check`: passed.

## Independent review and repair

The first review found one high (the bounded ordered definition was not itself persisted/versioned), two mediums (failure simulation was not reachable from the product and archive/cascade tamper coverage was incomplete), and one low (per-playbook authority was not visible). Repairs added a canonical schema-versioned connector/read/deduplicate/preview definition, persisted and digested it, validate exact authority and recomputed provenance on list/dry run/manual run/restore, expose definition and authority per playbook, add a fixture-only synthetic failure control, and add inner archive authority/definition tamper plus direct cascade coverage. Final verdict: clean pass, blocker 0 / high 0 / medium 0.
