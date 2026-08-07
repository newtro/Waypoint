# Waypoint implementation status audit

Status as of 2026-08-06. This is the canonical promised-feature trace for selecting subsequent Build-to-Complete phases.

| Roadmap capability | Current status | Next evidence / gate |
|---|---|---|
| Native Electron/React desktop, onboarding, chat-first UI, window restore | Implemented; packaged macOS verified; Windows first-pass install/build/package/launch gate completed at `85abec5` | Windows signing, update, installer/distribution, and broader user acceptance remain open |
| Durable chats, documents, memories, graph, attachments, text/semantic search | Production local PDF/DOCX/TXT/Markdown extraction, provenance-bearing deterministic chunks, optional bounded Ollama indexing, reindex/rollback, lifecycle, backup/restore, and chat-first controls are implemented and packaged-Mac verified | Direct llama.cpp, Chonkie evaluation/native packaging, OCR, peer embeddings, hostile-document test expansion, Windows validation, and physical-device validation remain separately gated |
| Signed-in Codex/Claude CLI chat, streaming, cancel/retry/failure, visible routing | Implemented and packaged-Mac verified | Windows CLI/process matrix remains hardware-contingent |
| Security profiles and bounded one-child lineage | R5 Slices 2/4 add explicit typed Claude child tasks plus trusted, visible, durable root/child budgets for prompt/output/duration/concurrency/depth/children/attempts/attachments/fallback/cost/device authority and cancel/recovery | Codex no-tool child mode, user-approved wider policies, and real peer execution remain later reviewed gates |
| Activity, local cascade deletion, export/restore, diagnostics, backup/migrations | Local backup administration provides read-only integrity verification and isolated real-path restore drills in a bounded off-main worker; Slices 1–2 passed | Encryption, automation/retention, cloud destinations, live replacement, Windows, and signed release remain later gates |
| Hosted opaque relay, enrollment/revocation/rotation, canonical sync, resumable attachments | Implemented; live dedicated relay updated | Two-physical-Mac and Mac↔Windows matrices intentionally deferred until planned features finish |
| Windows delivery, signing, notarization, updates | Windows Node/npm toolchain, full tests, package closure, and packaged app launch/exit are verified on real Windows hardware | Windows installer/signing/update channel and Apple signing/notarization require identities, distribution authority, and release policy |
| Commitments and memory suggestions | Implemented in R3 Slice 1; local review-first gate passed | Provider-assisted extraction and cross-device canonical commitment sync remain later separately reviewed extensions |
| Daily briefing | Implemented in R3 Slice 2 as manual local review | Scheduling/delivery and authorized external sources remain later explicit gates |
| Learned rule suggestions and navigable graph | Implemented in R3 Slice 3 as local advisory rules | Automatic rule application remains a separately reviewed authority boundary |
| Unified activity timeline | Implemented in R3 Slice 4 with normalized families, safe filtering/linking, deletion truthfulness, and content-minimized projection | New meeting/automation producers appear only with their separately authorized feature slices |
| Audio-only meeting capture | Implemented in R3 Slice 5 as explicit-consent local-only capture, playback/export, manual transcript review, and source-owned memory | Automatic local transcription model, meeting sync, diarization, Windows media, and external transcription remain separately gated |
| Schedules and playbooks | R4 Slice 1 implemented locally: synthetic read-only connector, versioned paused playbooks, DST-aware previews, mandatory dry runs, idempotent manual fixture execution, bounded retry/dead-letter, kill, audit, backup/restore, and cascade deletion | Unattended scheduling and every real connector/action remain authorization-gated |
| Email/Teams/Outlook/calendar/DevOps/webhooks | P1 local trigger simulation is implemented. The separately authorized production inbound vertical slice is live at the existing relay origin with per-workspace signed opaque intake, replay defense, quarantine/review, authenticated desktop pull, rotation/revocation/kill/delete, backup/recovery, and zero automatic effects | Real sender/account connectors, app registration, tenant credentials/data, schedules, outbound actions/writes, and broader public ingress remain separately authorized gates |
| Multi-provider/model routing and multi-agent execution | R5 provides versioned local Codex/Claude routing, bounded one-child lineage, execution receipts/budgets, and local embedding/chunking evaluation. P6B provides the trusted-main tool contract, local terminal/CLI and domain bridge, UI observability, native-CLI timeline, and reviewed Agent Browser preview. P6C provides protected workspace-scoped failure preflight. P6D provides protected, explicitly activated OpenRouter routing/cost controls. P6E adds controlled opt-in Web Search and Fetch | Live hosted-provider validation, broader browser actions, full peer agent execution, PRs, deployments, and external accounts remain explicit activation gates; P6A paired evaluation stays at the roadmap bottom |
| Mobile companion | Planning only | R6 requires platform/distribution decisions; no store/push/publishing authority exists |
| Memory consolidation / reflection | P8 complete | Explicit signed-in-CLI, bounded source review, provenance/diffs, accept/edit/reject/rollback, cancellation/kill/restart recovery, cascade deletion and backup lifecycle passed the clean phase gate; scheduling and low-risk auto-apply still require separate user policy authorization |
| Manual Screen Capture + Markup | Implemented; automated/package/non-consented macOS gate and final 0-blocker/0-high review passed | User consent is required for the final real macOS region edit/save pass; Windows PrtSc/native picker remains physical-Windows validation |

## Post-R5 safe sequencing

The remaining R5 expansions require a wider user policy or device/network authority: wider execution budgets, Codex no-tool child mode, peer execution, new providers/APIs, and remote embedding workers. R6 mobile requires platform/cache/distribution/notification/device decisions and hardware. These gates are recorded without inventing permission. The next documented safe local feature is therefore backup administration: explicit verification and isolated restore drills using the existing local export/restore contract.

After Backup Slice 1, proactive webhooks/calendar remain external-authority gated, backup encryption/automatic retention require key-recovery/retention policy, and mobile/peer execution remain device-policy gated. Backup Slice 2 is the next safe ordered local work: off-main responsiveness hardening for the already approved explicit verification/drill operations.

Production local document ingestion, P1 local trigger/webhook simulation, bounded P2 local voice chat, and the P4 Recall-style activity timeline foundation are complete. P4 does not claim native capture availability: macOS permission/live capture and Windows remain explicit device gates. The approved combined program next enters P5 cross-device command/agent control after P4's clean independent gate. Two-physical-device validation remains deferred and no Windows run is claimed.

The complete remaining trace is `outputs/ROADMAP_COMPLETION_ADDENDUM.md`: CrisperWhisper meeting lab → opt-in whole-device activity capture → local peer-control policy/simulation → richer local orchestration → calendar/meeting fixture contracts → local memory consolidation/reflection → two-instance validation. Real accounts/connectors, model installs, capture sync, peer activation, scheduled/auto-applied reflection, Windows/release, and mobile distribution remain separately authority/hardware gated.

## Sequencing decision

R0 and the locally implementable R1 product path are complete. R2's remaining work is intrinsically tied to unavailable Windows hardware, signing identities, notarization, update hosting, or distribution authority. By explicit user direction, those validations remain deferred rather than blocking planned feature implementation. Work therefore advances to R3 in its canonical slice order without claiming R2 release readiness.

Conservative R3 defaults are local-only, suggestion-first, no silent memory, no background send, no external account/source, and exact source provenance. These choices do not widen authority and may be made under the user's standing product-decision authorization.
# P6D status update — 2026-08-03

- **Complete (fixture/contract gate):** protected OpenRouter configuration, explicit activation, model routing preferences, cost dashboard/caps, subscription fallback, hosted chat execution/cancel, durable receipts/timeline, backup/restore, incremental/replacement sync, and provider-domain settings seam.
- **Not claimed:** live OpenRouter health/model availability or paid execution. Those require the user to enter a key and explicitly activate hosted requests.
- **Non-gating follow-up:** transactional hosted completion and finer-grained durable provider progress events.
# 2026-08-04 — Controlled Web Search and Fetch complete

The model-neutral Tool Gateway now includes opt-in `web.search` and `web.fetch`, visible receipts/timeline provenance, protected Brave Search key setup, bounded sanitized output, explicit URLs, cancellation/global stop, failure-learning compatibility, backup/restore, workspace isolation, and SSRF-resistant public-HTTPS transport with DNS-to-socket pinning. Full verification and independent review closed at 0 blocker/high. Per-workspace concurrency accounting and interruptible DNS resolution remain tracked medium hardening items.

# 2026-08-06 — Windows first-pass and next phase

Windows is now verified for a clean Node 24/npm 12 install, 480-test/lint/build gate, native filesystem safeguards, Windows package/runtime closure, and real packaged UI launch/exit. This does **not** establish signing, installer/update delivery, real Windows CLI/provider behavior, cross-device Mac↔Windows execution/sync, or release readiness.

The highest-priority implementation-ready next phase is completion of Cross-Device Agent Execution: authenticated worker presence/health, preferred-device and failover routing, resumable policy-bound leases, real Codex/Claude worker delegation where locally authorized, cancellation/recovery, and same-machine isolated-peer matrices. Meeting Intelligence follows. After those safely implementable phases, run the mandatory two-instance sync matrix, then physical Mac↔Windows validation before any cross-device readiness claim.

# 2026-08-06 — Optional relay / desktop peer-host decision

The hosted Ubuntu relay remains implemented and operational but is no longer a required topology component. Desktop-host mode is now implemented as an explicit native product path: a protected stable host certificate, pinned HTTPS transport, signed/replay-bounded device requests, one-use enrollment, existing revocation/rotation/message and agent-control services, visible endpoint/fingerprint/offline state, and fail-closed relay-only webhooks. An isolated two-identity test proves enrollment, approval, key delivery, outage, stable restart, and peer reconnection without the VM. Full tests, dependency policy/audit, build, and packaged-macOS runtime closure pass. No VM infrastructure was changed.

Remaining cross-device gates are hostile-LAN and sleep/network-change field validation, real two-running-instance convergence, two physical devices, and native Mac↔Windows execution. Optional automatic relay fallback is not enabled; topology changes remain explicit. The next safe product phase remains Meeting Intelligence completion, followed by the deferred two-instance matrix before any cross-device readiness claim.

# Post desktop-host roadmap audit — 2026-08-06

**Shipped:** chat-first durable local product; signed-in Codex/Claude and protected OpenRouter routing; attachments/document extraction/indexing; memory graph, commitments, briefing, rules, activity/Recall capture foundation, reflection, timeline, meetings/manual transcript, local voice, trigger/playbook lab plus signed inbound webhook, backups/restore drills, model-neutral tool gateway/failure learning/browser preview/web tools, encrypted relay sync, cross-device leases/worker commands, and optional direct desktop-host transport.

**Meeting Intelligence completed:** the bundled Fast Local Whisper tiny.en runtime now produces an explicitly unreviewed local English draft for bounded recordings (ten minutes / 25 MiB), with readiness probing, sequential resource-bounded segments, progress/cancel/global stop, atomic optimistic commit, hard-delete cancellation, no diarization claims, and preserved manual review/source-owned memory lifecycle. Longer meetings retain manual transcript review; CrisperWhisper and diarization remain tracked evaluation gates.

**Next safe ordered work:** run the deferred two-running-instance convergence and direct-host command matrix before claiming cross-device readiness. Chonkie/chunk-policy evaluation, richer local orchestration, and the roadmap-bottom P6A paired-model harness remain safe later labs rather than prerequisites.

**Genuine gates:** physical Mac↔Windows and two-device validation; Windows/macOS signing, notarization, installer/update distribution identities; Microsoft/Teams/Outlook/calendar/DevOps tenant registrations, consent, scopes, and work data; external schedules/sends/unattended actions; public relay fallback activation policy; mobile platform/store/push authority and hardware; commercial realtime voice/provider activation or large model licenses/assets; real OpenRouter/provider calls and costs. These features remain tracked and are not dropped.
