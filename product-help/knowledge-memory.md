# Knowledge, memory, and planning

Knowledge is Waypoint’s durable, workspace-scoped information layer. It includes imported documents, memories, commitments, relationships, briefings, rules, meeting sources, and reviewable reflection proposals.

## Importing and finding documents

Import PDF, DOCX, TXT, or Markdown through the Knowledge document controls or the relevant capture/attachment action. Waypoint extracts content locally, stores source provenance, creates bounded deterministic chunks, and can build a local semantic index when an approved local embedding provider is ready. Keyword search remains available when an embedding provider is unavailable.

Reindexing records model, provider, and chunking provenance. An index replacement is isolated and reversible until activation. Deleting the source cascades to owned chunks and embeddings. Chonkie and other chunking strategies are tracked evaluation candidates, not silently active dependencies.

## Memories, commitments, and relationships

The agent can propose or create workspace memories through approved domain flows. Commitments have status and source traceability. The graph connects durable entities and lets the user navigate relationships without granting cross-workspace access.

The daily briefing is a manual local review of current workspace signals. It does not automatically email, schedule, or send anything. Learned rules are suggestions until the user accepts them; acceptance does not silently authorize an external action.

## Reflection

Memory Consolidation / Reflection analyzes a bounded, explicit workspace source set through a signed-in CLI when available. It produces separate proposals for stale, duplicate, contradictory, or related material. The user can accept, edit, reject, or roll back proposals; sources are not overwritten in place. Source deletion, backup, and workspace isolation remain enforced.

## Cross-workspace roll-ups

A Personal workspace can request only approved summary families from explicitly opted-in owned workspaces. Grants do not expose raw chats, full documents, attachments, secrets, or unapproved bodies. Revocation stops future roll-ups and is visible in audit history.

## Current limitations

OCR is not a separate built-in document service. Image understanding depends on a configured image-capable route and an explicit user request. External calendars, Outlook, Teams, email, and work systems require separate account and tenant authorization.

## Privacy and data handling

Knowledge is isolated by workspace. Source provenance and hard deletion are part of the data model. Provider-assisted operations use the configured policy and minimum relevant text; they never receive another workspace’s raw content through a roll-up grant.
