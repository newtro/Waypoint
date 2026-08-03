# R3 Slice 2 — local daily briefing evidence

## Implemented boundary

Waypoint now composes an explicitly invoked daily briefing from open local commitments and bounded excerpts of durable notes and memories. It prioritizes commitments, orders knowledge by freshness, exposes source kind/identity/update time, explains why each item was included, labels freshness, reports exact live coverage and limit omissions, and states which external and recurring sources were not checked.

The operating-system IANA timezone is supplied by the renderer and the calculated local day is visible. A user can dismiss an item for that local day; dismissal stores no source content, is isolated to the workspace, and expires behaviorally outside that day. Source or workspace deletion removes its dismissal metadata. Historical content-free day keys remain until that lifecycle event; bounded age-based cleanup is a non-blocking later hardening item.

No model, connector, account, schedule, notification, webhook, or send path is involved.

## Verification trace

| Acceptance area | Evidence |
|---|---|
| Time semantics | Deterministic pure fixtures cover invalid zones, UTC-crossing local days, and US DST transition instants. |
| Truthful composition | Fixtures and integration tests cover commitment priority, global recent ordering, today/recent/stale labels, source identity/update time, exact live counts, bounded output, and explicit external/recurrence/incompleteness disclosures. |
| Privacy and resource bounds | SQL returns at most 31 commitment and 51-per-kind candidates with 4,000-character source excerpts; the composer emits at most 50. Dismissal/activity metadata contains no copied source body. |
| Lifecycle | Integration tests cover per-day persistence/reappearance, workspace isolation, invalid inputs, source deletion cleanup, and ordered schema 10 migration. |
| Product surface | Briefing is a compact left-rail tool that opens an accessible modal drawer with Refresh, Dismiss today, coverage, omissions, and visible excerpt labeling. |

Windows-native and two-physical-device validation remain deferred by user direction. Schedule/delivery remains a separate user-decision gate and was not inferred.

Independent final verdict: blocker 0 / high 0 / medium 1 / low 0. The sole medium was the corrected evidence wording about behavioral expiry versus physical pruning; it is not a functional gate failure.
