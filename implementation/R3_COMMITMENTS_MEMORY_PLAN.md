# R3 Slice 1 — commitments and memory suggestions

## Scope

Add a local, review-first derived-knowledge flow for existing durable conversations. Waypoint identifies bounded candidate commitments, decisions, facts, people, projects, and dates; every candidate preserves exact message/span provenance, confidence, extractor version, workspace ownership, and review state. A user can accept, edit-and-accept, or reject. Accepted commitments remain typed and actionable; accepted non-commitments become existing durable memories with provenance.

No external source, API, account, background schedule, silent auto-save, audio, connector, or provider credential enters this slice. The extractor is deterministic and local; later CLI-assisted extraction can be a separate versioned provider only after its quality/privacy gate.

## Acceptance criteria

1. Suggestions are workspace-scoped, idempotent for the same extractor/source/span/content, bounded per scan, and store no content beyond the exact displayed source excerpt and candidate text.
2. Each suggestion identifies source message, chat, role, UTF-16 character span, source-body digest, extractor/version, category, confidence, creation time, and review status. Invalid, deleted, or changed sources cannot be accepted.
3. Accept/edit/reject are explicit and terminal. Acceptance atomically creates a typed commitment or durable memory, a provenance relationship where supported, and content-minimized activity. Rejection creates no hidden profile or rule.
4. Source message/chat deletion cascade-deletes pending suggestions and source-owned derived commitments/memories; accepted workspace-owned memory follows its disclosed detach policy. No search, graph, sync, backup, or activity artifact retains deleted source content contrary to ownership.
5. The chat-first UI exposes suggestions unobtrusively in Knowledge with scan, category/confidence/source context, accept/edit/reject, and commitment completion. Keyboard labels and narrow desktop layout remain usable.
6. Versioned representative fixtures cover true/false commitments, decisions, dates, duplicates, source spans, role handling, confidence thresholds, contradiction/update boundaries, rejection, and deletion.
7. Focused/full tests, migrations, lint/build/audit, macOS package/runtime/native launch, and an independent provenance/privacy/lifecycle review finish with no blocker/high finding.

## Conservative decisions

- Nothing auto-saves. Default threshold is 0.72 and only explicit linguistic markers produce suggestions.
- Rejected candidates retain only their bounded candidate/provenance record so the same extractor version does not immediately re-suggest them; rejection does not train a user profile.
- Accepted commitments are source-owned and deleted with their source conversation. Accepted ordinary memories use the existing source-linked workspace-owned detach behavior unless the user explicitly chooses a future source-owned mode.
- The first extractor is `local-patterns-v1`, deterministic and offline. Its metrics are reported only on the repository fixture suite, not as general language-understanding quality.
