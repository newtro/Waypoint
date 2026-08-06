# P10 — Cross-Workspace Rollups

## Acceptance boundary

- A destination workspace receives only explicitly enabled summary families from explicitly selected local source workspaces.
- Supported deterministic families are commitments, meetings, and briefing/status counts. Chat text, document/revision bodies, attachment data, memory bodies, credentials, and secrets are excluded.
- Sharing grants are security settings changed only through user UI IPC. The AI/domain bridge may compose a roll-up from existing grants but cannot create or widen them.
- Revoke is immediate. Database foreign keys cascade grants when either workspace is removed. Backup/restore preserves grants only when the referenced source workspace identity exists locally; unavailable sources are omitted without widening access.
- The feature makes no external request and invokes no provider. Provider-assisted prose is a later use of the already-configured provider policy, not part of this deterministic slice.

## Verification

- Focused tests cover explicit family grants, provenance, raw-body exclusion, ungranted workspace exclusion, self-grant rejection, revoke, and migration.
- Full regression, lint, build, macOS package closure, and independent privacy review are required before the phase is terminal.
- Grant policy is journaled through encrypted workspace sync. Inbound policies validate every source locally, fail closed while a source identity is unavailable, and persist without creating an outbound echo. Two-physical-device convergence remains a user/hardware validation gate.
