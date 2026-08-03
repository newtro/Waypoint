# P1 — local proactive triggers and webhook lab

Status: acceptance frozen 2026-08-03.

## Scope

Add an authority-free, workspace-scoped laboratory for bounded local event envelopes and synthetic webhook payloads. An observed event may produce a suggested rule; the user may approve it only into a paused state; dry runs report proposed local effects but execute none. A workspace kill switch dominates evaluation. No port, URL, socket, schedule, model, network call, credential, connector, external data, outbound delivery, or unattended effect is enabled.

## Acceptance gate

1. Versioned envelopes bind workspace, local synthetic source, event type, timestamp, idempotency key, payload digest, schema version, and bounded primitive payload. Payload content is untrusted data and cannot declare scopes/actions/tools/prompts/providers/schedules or authority.
2. Ingestion rejects malformed/oversized/nested/forbidden payloads, stale/future timestamps, replayed idempotency keys, and workspace mismatch. Accepted events are quarantined local fixtures with visible status/provenance.
3. Suggestions are deterministic and versioned. Approval creates a paused simulation-only rule. No rule can become active or unattended in this slice.
4. Dry run requires the exact current rule/event digest and produces zero effects. Retry/dead-letter state is bounded, visible, content-minimized, and idempotent. A workspace kill switch prevents new evaluations immediately.
5. Events, rules, and runs are workspace-isolated, bounded, backup/restorable, and hard-delete with their owning workspace/rule/event. Activity records contain no payload bodies.
6. Chat-first Automations UI exposes synthetic event creation, suggested/paused state, provenance, dry run, failure/dead-letter, delete, and kill status with truthful capability text.
7. Tests cover validation, replay, determinism, digest staleness, kill, retry/dead-letter, restart, backup/restore, deletion, workspace isolation, migration, package/native behavior, and independent adversarial review.

## Later activation gates

Public ingress requires explicit DNS/TLS/network authority, per-source secret rotation, signature verification, replay/quota/quarantine controls, monitoring, rollback, and network security review. Background schedules, external connectors/data, writes/sends, model invocation, and unattended policy stages each require separate authorization.
