# R3 Slice 2 — local daily briefing

## Scope

Add an explicitly invoked, locally composed daily briefing over the current workspace's durable commitments, notes, and memories. Each briefing item explains why it was included, shows source kind/identity/update time and freshness, and can be dismissed for the current local day. The briefing states material omissions and never implies that disconnected calendars, email, Teams, DevOps, meetings, schedules, or other accounts were checked.

This slice does not schedule, notify, send, connect an account, read external data, invoke a model, or create new authority. Schedule/delivery remains a user-decision gate for later work.

## Acceptance criteria

1. Composition is deterministic for the same workspace, instant, timezone, source state, and dismissal state; invalid timezones fail closed.
2. Open commitments are prioritized, followed by bounded recent notes/memories. Every item includes stable identity, source kind/id, source updated time, freshness, and a plain-language inclusion reason.
3. The briefing exposes its local calendar day/timezone, generated-at time, coverage counts, truncation, stale/missing source state, and explicit external-source/recurrence omissions. It never claims completeness.
4. Dismissal is explicit, workspace-scoped, durable for one local day, idempotent, and reversible by composing a later day. Source deletion cascades dismissal metadata; no source body is copied into dismissal/activity records.
5. The chat-first UI exposes Briefing as a compact left-rail entry and invoked drawer with Refresh and Dismiss controls, usable by keyboard and at existing desktop breakpoints.
6. Tests cover workspace isolation, deterministic ordering, bounds, missing sources, dismissals, stale/recent state, timezone validation, UTC-crossing local days, DST transition days, and deletion lifecycle.
7. Focused/full tests, migration, lint/build/audit, macOS package/runtime/native launch, and independent privacy/truthfulness/lifecycle review pass with no blocker/high finding.

## Conservative decisions

- Manual refresh only; no schedule or notification permission is inferred.
- Local day is calculated with the user-selected IANA timezone. Waypoint defaults the request to the operating-system timezone in the renderer and stores no location.
- The briefing contains at most 50 items: up to 30 open commitments and then the most recently updated notes/memories. Overflow is disclosed numerically.
- Dismissals contain only workspace, source identity/kind, local day, and timestamp. They expire behaviorally on the next local day and are deleted with their source.
