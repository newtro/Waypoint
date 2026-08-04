# P8 Memory Consolidation / Reflection — implementation evidence

## Acceptance gate

- Explicit workspace-scoped runs accept 1–50 visible memories/documents and reject cross-workspace sources.
- An already signed-in Codex or Claude Code CLI runs read-only, without tools, persistence, APIs, or secrets, under 120-second / 256-KiB output bounds.
- Strict marker/JSON parsing accepts only known proposal kinds and exact selected source IDs; malformed or failed CLI output creates a truthful failed run.
- Review proposals retain exact source IDs/digests and require accept, edit-and-accept, reject, or rollback. Contradictions cannot be accepted without an edit.
- Acceptance atomically revalidates every source digest. Source deletion removes accepted derivatives, stales pending evidence, and cannot leave an orphaned current assertion.
- Reflection data is workspace isolated and round-trips through backup/restore with remapped provenance. Original sources are never overwritten.
- No scheduling or auto-apply is enabled. Experimental full-duplex voice remains frozen and out of scope.

## Verification evidence

- Focused reflection + migration + backup suites: 14/14 passing.
- TypeScript, renderer build, and lint: passing.
- Signed-in Codex CLI bounded marker smoke test: completed successfully in read-only ephemeral mode.
- Full suite and packaged macOS closure pass. Independent adversarial re-review found no unresolved blocker/high finding.

## Decisions

- Deterministic stale/duplicate checks remain only as an internal preflight used to establish durable source provenance; user-visible analysis is replaced by strictly validated CLI proposals before a successful run is returned.
- Reflection output is a proposal set, never canonical truth. Accepted revisions are new source-owned memories with rollback lineage.
- Scheduling and low-risk auto-apply remain authority-gated future work.
