# R3 Slice 3 — knowledge graph and learned-rule suggestions

## Scope

Expose the existing workspace relationship graph inside the invoked Knowledge drawer and add a local, review-first learned-rule flow. The deterministic extractor proposes a rule only when at least two distinct user messages contain the same explicit directive. Every suggestion retains exact message provenance and remains advisory: approval creates a versioned workspace rule, but no rule can change prompts, providers, tools, security profiles, schedules, sync, or external state in this slice.

## Acceptance criteria

1. Graph nodes/edges remain workspace-isolated and navigable from the Knowledge drawer with node kind/title and relationship direction/type visible.
2. Rule extraction is deterministic, local, bounded, user-role-only, and requires at least two distinct exact directive sources. Suggestions preserve source message/chat, exact excerpt, source digest, extractor/version, confidence, and workspace scope.
3. A changed/deleted source cannot support approval. Dropping below two valid sources invalidates the source-owned suggestion and any derived approved rule under the documented cascade policy.
4. Dry run is required before approval and reports bounded match counts/source identities without applying changes. Approval, rejection, disable, re-enable, and revert are explicit and terminal/auditable as appropriate.
5. Approved rules are versioned advisory statements with workspace-only scope. Outcome history is content-minimized and cannot grant authority or trigger execution.
6. UI exposes suggestions, provenance count, Dry run, Approve, Reject, enabled/disabled rules, state controls, history, and graph without competing with chat.
7. Tests cover false positives, normalization/deduplication, role filtering, workspace isolation, changed/deleted sources, dry-run-before-approval, version/state rollback, deterministic bounds, cascade deletion, migration, and content-minimized history.
8. Full tests, lint/build/audit, macOS package/runtime/native launch, and independent privacy/authority/lifecycle review pass with no blocker/high finding.

## Conservative decisions

- Scope is always the current workspace. Rules are advisory local records only in this slice.
- Extract only explicit `Always …`, `Never …`, or `Please … instead` directives repeated in two user messages. Maximum scan is 500 messages / 1,000,000 characters / 100 candidates.
- Approval requires a successful dry run for the same suggestion fingerprint and current sources. Approved rules begin enabled; revert returns to the immediately prior enabled state.
- Suggestions and rules are source-owned. Provenance loss below two messages removes them rather than silently preserving an inferred profile.
