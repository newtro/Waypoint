# R3 Slice 1 — commitments and memory suggestions evidence

## Implemented boundary

Waypoint now performs an explicit, local-only review pass over a selected conversation. The versioned `local-patterns` extractor proposes bounded commitments, decisions, facts, people, projects, and dates without contacting a model or external service. Suggestions retain exact source text, UTF-16 character offsets, role, chat/message identity, extractor/version, confidence, and a SHA-256 source-body digest. Nothing becomes durable knowledge until the user accepts or edits-and-accepts it.

Accepted user commitments remain source-owned and can be completed or reopened. Accepted non-commitments become existing workspace-owned memories with a provenance relationship and detach when their source is deleted. Rejection is terminal for the exact versioned suggestion and creates no learned profile.

## Verification trace

| Acceptance area | Evidence |
|---|---|
| Deterministic extraction and exact provenance | Versioned fixture tests cover categories, false positives, Unicode/whitespace spans, source-bound fingerprints, and the 100-suggestion bound. Source digest, role, chat, span, and excerpt are revalidated atomically before resolution. |
| Resource bounds | A scan reads at most 200 messages, skips messages over 100,000 characters, processes at most 1,000,000 characters, lazily segments text, and emits at most 100 suggestions. Oversize/aggregate-limit tests pass. |
| Explicit review lifecycle | Integration tests cover accept, edit-and-accept, reject, terminal double resolution, completion/reopen, invalid/stale source, assistant-role filtering, and workspace isolation. |
| Deletion and durability | Chat deletion cascades suggestions/commitments while accepted workspace-owned memory survives detached. Export/restore remaps suggestions and commitments to fresh identities. Schema 9 adds source digests through an ordered migration. |
| Product surface | The invoked Knowledge drawer exposes Review conversation, exact source context, confidence/category/role, Accept, Edit & accept, Reject, commitments, and complete/reopen controls. No background extraction or external transmission occurs. |

Terminal local verification: 49 suites / 235 tests, ESLint, TypeScript/Vite production build, zero production dependency vulnerabilities, native macOS arm64 directory package, packaged import closure, diff hygiene, and a bounded isolated-profile native launch all pass. The package is intentionally unsigned; Windows remains platform-contingent.

## Review and residual boundaries

The first independent review found two highs: stale/non-exact provenance and unbounded main-process scan work. Both were repaired with exact source slices plus atomic digest validation and strict lazy scan budgets. A re-review found one migration high; schema-8 pending suggestions now backfill only from an exact current source or are invalidated for safe regeneration. The final independent verdict is gate clean: blocker 0 / high 0 / medium 0 / low 1. The sole low is a test-strengthening opportunity for direct single-message deletion; the production transaction and accepted chat cascade/detach path are already covered.

This slice does not claim semantic extraction quality, contradiction reconciliation, silent memory, scheduled scanning, provider-assisted extraction, commitment sync as a new canonical object type, two-physical-device behavior, or Windows-native validation. Those remain later explicit gates.
