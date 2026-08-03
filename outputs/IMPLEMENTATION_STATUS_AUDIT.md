# Waypoint implementation status audit

Status as of 2026-08-03. This is the canonical promised-feature trace for selecting subsequent Build-to-Complete phases.

| Roadmap capability | Current status | Next evidence / gate |
|---|---|---|
| Native Electron/React desktop, onboarding, chat-first UI, window restore | Implemented and current-Mac verified | Windows-native verification remains hardware-contingent |
| Durable chats, documents, memories, graph, attachments, text/semantic search | Production local PDF/DOCX/TXT/Markdown extraction, provenance-bearing deterministic chunks, optional bounded Ollama indexing, reindex/rollback, lifecycle, backup/restore, and chat-first controls are implemented and packaged-Mac verified | Direct llama.cpp, Chonkie evaluation/native packaging, OCR, peer embeddings, hostile-document test expansion, Windows validation, and physical-device validation remain separately gated |
| Signed-in Codex/Claude CLI chat, streaming, cancel/retry/failure, visible routing | Implemented and packaged-Mac verified | Windows CLI/process matrix remains hardware-contingent |
| Security profiles and bounded one-child lineage | R5 Slices 2/4 add explicit typed Claude child tasks plus trusted, visible, durable root/child budgets for prompt/output/duration/concurrency/depth/children/attempts/attachments/fallback/cost/device authority and cancel/recovery | Codex no-tool child mode, user-approved wider policies, and real peer execution remain later reviewed gates |
| Activity, local cascade deletion, export/restore, diagnostics, backup/migrations | Local backup administration provides read-only integrity verification and isolated real-path restore drills in a bounded off-main worker; Slices 1–2 passed | Encryption, automation/retention, cloud destinations, live replacement, Windows, and signed release remain later gates |
| Hosted opaque relay, enrollment/revocation/rotation, canonical sync, resumable attachments | Implemented; live dedicated relay updated | Two-physical-Mac and Mac↔Windows matrices intentionally deferred until planned features finish |
| Windows delivery, signing, notarization, updates | Not implemented/validated | R2 requires Windows hardware plus Apple/Windows signing and update-channel authority; deferred, not treated as a feature-development blocker |
| Commitments and memory suggestions | Implemented in R3 Slice 1; local review-first gate passed | Provider-assisted extraction and cross-device canonical commitment sync remain later separately reviewed extensions |
| Daily briefing | Implemented in R3 Slice 2 as manual local review | Scheduling/delivery and authorized external sources remain later explicit gates |
| Learned rule suggestions and navigable graph | Implemented in R3 Slice 3 as local advisory rules | Automatic rule application remains a separately reviewed authority boundary |
| Unified activity timeline | Implemented in R3 Slice 4 with normalized families, safe filtering/linking, deletion truthfulness, and content-minimized projection | New meeting/automation producers appear only with their separately authorized feature slices |
| Audio-only meeting capture | Implemented in R3 Slice 5 as explicit-consent local-only capture, playback/export, manual transcript review, and source-owned memory | Automatic local transcription model, meeting sync, diarization, Windows media, and external transcription remain separately gated |
| Schedules and playbooks | R4 Slice 1 implemented locally: synthetic read-only connector, versioned paused playbooks, DST-aware previews, mandatory dry runs, idempotent manual fixture execution, bounded retry/dead-letter, kill, audit, backup/restore, and cascade deletion | Unattended scheduling and every real connector/action remain authorization-gated |
| Email/Teams/Outlook/calendar/DevOps/webhooks | P1 local trigger/webhook simulation is implemented: bounded quarantined fixtures, suggested/paused rules, zero-effect dry runs, retry/dead-letter, kill/delete, audit, backup/restore, and strict provenance | Any public endpoint, app registration, account, tenant, credential, real data, schedule, external action, or write needs explicit authorization |
| Multi-provider/model routing and multi-agent execution | R5 Slice 1 adds a versioned local Codex/Claude capability registry, explainable fail-closed route proposal/enforcement, attachment eligibility, and explicit no-fallback default; one-child lineage remains | Richer budgets/typed agents/peer execution and APIs/costs/providers require later gates and authorization |
| Mobile companion | Planning only | R6 requires platform/distribution decisions; no store/push/publishing authority exists |

## Post-R5 safe sequencing

The remaining R5 expansions require a wider user policy or device/network authority: wider execution budgets, Codex no-tool child mode, peer execution, new providers/APIs, and remote embedding workers. R6 mobile requires platform/cache/distribution/notification/device decisions and hardware. These gates are recorded without inventing permission. The next documented safe local feature is therefore backup administration: explicit verification and isolated restore drills using the existing local export/restore contract.

After Backup Slice 1, proactive webhooks/calendar remain external-authority gated, backup encryption/automatic retention require key-recovery/retention policy, and mobile/peer execution remain device-policy gated. Backup Slice 2 is the next safe ordered local work: off-main responsiveness hardening for the already approved explicit verification/drill operations.

Production local document ingestion and P1 local trigger/webhook simulation are complete. The next safe substantive phase is first-class local voice chat (no cloud API or implicit model download). Two-instance sync testing remains after the ordered safely implementable feature gates.

The complete remaining trace is `outputs/ROADMAP_COMPLETION_ADDENDUM.md`: local triggers → live voice → CrisperWhisper meeting lab → opt-in whole-device activity capture → local peer-control policy/simulation → richer local orchestration → calendar/meeting fixture contracts → two-instance validation. Real accounts/connectors/public ingress, model installs, capture sync, peer activation, Windows/release, and mobile distribution remain separately authority/hardware gated.

## Sequencing decision

R0 and the locally implementable R1 product path are complete. R2's remaining work is intrinsically tied to unavailable Windows hardware, signing identities, notarization, update hosting, or distribution authority. By explicit user direction, those validations remain deferred rather than blocking planned feature implementation. Work therefore advances to R3 in its canonical slice order without claiming R2 release readiness.

Conservative R3 defaults are local-only, suggestion-first, no silent memory, no background send, no external account/source, and exact source provenance. These choices do not widen authority and may be made under the user's standing product-decision authorization.
