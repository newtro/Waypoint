# Waypoint implementation status audit

Status as of 2026-08-03. This is the canonical promised-feature trace for selecting subsequent Build-to-Complete phases.

| Roadmap capability | Current status | Next evidence / gate |
|---|---|---|
| Native Electron/React desktop, onboarding, chat-first UI, window restore | Implemented and current-Mac verified | Windows-native verification remains hardware-contingent |
| Durable chats, documents, memories, graph, attachments, text/semantic search | Implemented | PDF/DOCX extraction, richer chunking, and optional peer embeddings remain later evaluated providers |
| Signed-in Codex/Claude CLI chat, streaming, cancel/retry/failure, visible routing | Implemented and packaged-Mac verified | Windows CLI/process matrix remains hardware-contingent |
| Security profiles and bounded one-child lineage | Implemented local foundation | Policy routing, richer budgets, recovery, and real peer execution remain R5/R2 evidence |
| Activity, local cascade deletion, export/restore, diagnostics, backup/migrations | Implemented MVP baseline | Richer activity is R3; backup administration and signed release are later gates |
| Hosted opaque relay, enrollment/revocation/rotation, canonical sync, resumable attachments | Implemented; live dedicated relay updated | Two-physical-Mac and Mac↔Windows matrices intentionally deferred until planned features finish |
| Windows delivery, signing, notarization, updates | Not implemented/validated | R2 requires Windows hardware plus Apple/Windows signing and update-channel authority; deferred, not treated as a feature-development blocker |
| Commitments and memory suggestions | Implemented in R3 Slice 1; local review-first gate passed | Provider-assisted extraction and cross-device canonical commitment sync remain later separately reviewed extensions |
| Daily briefing | Implemented in R3 Slice 2 as manual local review | Scheduling/delivery and authorized external sources remain later explicit gates |
| Learned rule suggestions and navigable graph | Implemented in R3 Slice 3 as local advisory rules | Automatic rule application remains a separately reviewed authority boundary |
| Unified activity timeline | Implemented in R3 Slice 4 with normalized families, safe filtering/linking, deletion truthfulness, and content-minimized projection | New meeting/automation producers appear only with their separately authorized feature slices |
| Audio-only meeting capture | Implemented in R3 Slice 5 as explicit-consent local-only capture, playback/export, manual transcript review, and source-owned memory | Automatic local transcription model, meeting sync, diarization, Windows media, and external transcription remain separately gated |
| Schedules and playbooks | R4 Slice 1 implemented locally: synthetic read-only connector, versioned paused playbooks, DST-aware previews, mandatory dry runs, idempotent manual fixture execution, bounded retry/dead-letter, kill, audit, backup/restore, and cascade deletion | Unattended scheduling and every real connector/action remain authorization-gated |
| Email/Teams/Outlook/calendar/DevOps/webhooks | Architecture/plans only | R4 local fixture contracts may proceed; any app registration, account, tenant, credential, real data, webhook exposure, or write needs explicit authorization |
| Multi-provider/model routing and multi-agent execution | Partial CLI registry and one-child lineage | R5 policy/capability/budget phase; APIs/costs/providers require separate authorization |
| Mobile companion | Planning only | R6 requires platform/distribution decisions; no store/push/publishing authority exists |

## Sequencing decision

R0 and the locally implementable R1 product path are complete. R2's remaining work is intrinsically tied to unavailable Windows hardware, signing identities, notarization, update hosting, or distribution authority. By explicit user direction, those validations remain deferred rather than blocking planned feature implementation. Work therefore advances to R3 in its canonical slice order without claiming R2 release readiness.

Conservative R3 defaults are local-only, suggestion-first, no silent memory, no background send, no external account/source, and exact source provenance. These choices do not widen authority and may be made under the user's standing product-decision authorization.
