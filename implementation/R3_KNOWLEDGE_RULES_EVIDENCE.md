# R3 Slice 3 — knowledge graph and learned rules evidence

## Implemented boundary

Waypoint now exposes workspace relationship nodes and directed edges in a compact Graph & rules drawer. Message provenance nodes are included so relationships created by saving conversation knowledge are visible rather than filtered out.

The local `local-directives` 1.0.0 extractor proposes a rule only after two distinct user messages repeat the same explicit `Always`, `Never`, or `Please … instead` directive. Suggestions retain exact excerpts, spans, message/chat identity, source-body digests, confidence, extractor version, and workspace scope. A current dry run is mandatory before approval. Approved version-1 rules are advisory records only: they do not alter prompts, models, providers, tools, security profiles, schedules, sync, or external state.

Users can reject suggestions, approve after dry run, disable/re-enable rules, and revert the immediately prior state. Outcome history records only action, match count, version, and time. Suggestions and rules are source-owned and cascade away when valid provenance drops below two messages.

## Verification trace

| Acceptance area | Evidence |
|---|---|
| Extraction/provenance | Fixtures cover explicit/ordinary language, Unicode spans, normalization, user-role filtering, duplicate scans, source digest validation, and bounded input. |
| Review/authority | Integration tests require a current dry run, reject cross-workspace access, prove advisory scope/version, and cover disable/revert with content-minimized outcomes. |
| Lifecycle/durability | Changed sources fail validation; message deletion invalidates below-two-source suggestions and rules. Schema 11, backup/restore with remapped provenance, and hard-delete tables are covered. |
| Graph/UI | Existing relationships now retain document/chat/memory/message nodes. The modal drawer exposes sources, dry run, approval, rejection, rule state/history, and navigable graph nodes while keeping chat primary. |

No external data, account, model call, schedule, automation, or execution authority was introduced. Windows and two-physical-device validation remain deferred by explicit user direction.

## Terminal gate

- The initial independent review reported blocker 0 / high 3 / medium 2 / low 0. Repairs added transactional provenance reconciliation across every rule operation, source merging on rescans, content-minimized dry-run history coverage, visible message graph nodes, and an actual schema-10-to-11 migration fixture.
- The independent re-review verdict is clean: blocker 0 / high 0 / medium 0 / low 0.
- Final verification passed: 53 test suites / 254 tests, lint, production build, `npm audit --omit=dev` with 0 vulnerabilities, native macOS directory package, packaged runtime import closure, diff hygiene, and an isolated-profile packaged native launch.
- The macOS package remains intentionally unsigned in this local gate; Windows-native and two-physical-device verification remain platform-contingent.
