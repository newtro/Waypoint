# Waypoint roadmap completion addendum

Status: canonical implementation-readiness addendum, 2026-08-03. This document orders the remaining product work after production local document ingestion. It authorizes no implementation, account access, model download, public listener, deployment, external action, or release.

## Invariants and gate discipline

- Native Electron/TypeScript/React; no Docker build/runtime requirement. Local work remains useful when every relay, model, peer, or account is offline.
- Workspace isolation, explicit ownership, exact provenance, hard cascade deletion, local backup/restore, and content-minimized audit apply to every new canonical and derived object.
- Capability is not authority. Read, ingest, model access, draft, write/send, background execution, sync, and retention are separately declared grants.
- Every slice freezes acceptance, implements, tests/packages natively, receives independent adversarial review, repairs blocker/high findings, reverifies, and only then advances.
- Two-running-instance sync validation occurs after all safe local product slices below, but before any cross-device release-readiness claim. Two physical Macs and Windows remain separate hardware gates.

## Ordered execution map

| Order | Safe local product slice | Later authority-gated slice |
|---|---|---|
| P1 | Local proactive trigger engine and webhook simulation/configuration | Public TLS ingress, DNS/secrets, real webhook senders, schedules, outbound actions |
| P2 | Explicit-session local live voice baseline | User-approved model installation; any background/audio automation or cloud voice remains prohibited |
| P3 | Optional local CrisperWhisper meeting-transcription evaluation lab | Model/license access or installation approval; production adoption only after evidence |
| P4 | Opt-in local whole-device activity capture | Encrypted cross-device capture sync and any employer-managed-device use |
| P5 | Local cross-device command/control policy, UX, lease, and simulator | Real peer command execution and failover activation after two-instance/device security gates |
| P6 | Rich local multi-provider/model and agent orchestration | New API providers, costs, remote devices, or unattended execution |
| P7 | Local unified-calendar/meeting-copilot fixture contracts and review UX | Microsoft registration/tenant/account scopes, real data, writes, scheduling, and delivery |
| P8 | Local memory consolidation / reflection proposals | Scheduled runs or low-risk auto-apply require a later explicit policy authorization |
| V1 | Two isolated running app instances, then two physical Macs | Mac↔Windows matrix when Windows hardware is available |
| E1 | Connector/public-ingress activation stream | Provider-by-provider user/employer authority, credentials, network, retention, and writes |
| M1 | Mobile product/architecture prototype after V1 | Platform/store/push identities, physical devices, distribution, and publishing |

P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 is the default safe-local order. A slice may be marked ineligible only for a documented dependency/authority reason; that does not authorize skipping its release gate. V1 follows all completed eligible local slices and precedes claims about sync, peer control, or mobile readiness.

## P1 — proactive engine and webhook lab

Build a workspace-scoped event envelope and rule lifecycle: **observed event → suggested rule → user-edited/approved rule → dry run → explicitly activated policy**. Initial producers are local app events and bounded synthetic webhook fixtures only. Rules start suggested/paused; simulations propose effects but perform none. The UI shows source, version, last evaluation/run, authority snapshot, next step, failures/dead letters, pause, and global kill switch.

Acceptance:

- Versioned event/rule schemas enforce workspace, source, idempotency, replay window, payload/type/queue limits, provenance, and deletion/retention ownership.
- Deterministic simulation covers duplicate/out-of-order/replayed/malformed events, retries, dead letters, kill during evaluation, restart/recovery, source deletion, backup/restore, prompt-injection payloads, and no-authority behavior.
- Autonomous policy stages are explicit: simulation-only → user-confirm-each → narrowly approved unattended. This slice implements simulation-only and configuration; later stages remain unavailable.
- No bound port, public URL, DNS/TLS, schedule firing, external account, outbound delivery, or unattended side effect exists.

Activation gate: public ingress requires a dedicated endpoint, TLS/DNS authority, per-source secret/key rotation, quotas, quarantine, monitoring/kill, retention, rollback, and an independent network/security review. Each real sender is separately authorized.

## P2 — first-class local live voice

Use `whisper.cpp` as the preferred streaming STT baseline behind a swappable adapter and compare a swappable TTS adapter using native OS voices and Kokoro. The local turn manager owns explicit microphone permission/session consent, VAD, echo mitigation and headphones guidance, partial/final transcript states, interruption, and instant barge-in that stops playback and cancels or pauses agent generation. Speech enters the ordinary chat flow; agent text streams normally; TTS plays only during the active visible session. Bounded honest filler acknowledgments may mask CLI latency but never claim work or facts not yet produced.

Acceptance:

- Visible start/listening/thinking/speaking/paused/stopped/error states; keyboard/screen-reader controls; immediate stop; permission denial and runtime/model-unavailable states are truthful.
- No recording before explicit start, no background session, no implicit model download, no cloud voice API, and no unattended audio trigger.
- Barge-in, echo-loop resistance, headphones/no-headphones behavior, CLI cancel/pause races, long latency, sleep/device loss, malformed audio, disk/memory bounds, restart, and package behavior pass on Mac; Windows is hardware-contingent.
- User controls whether final transcripts persist as ordinary chat messages. Partial audio/transcripts are ephemeral; persisted content follows chat workspace/delete/backup/sync policy.

Install gate: exact whisper.cpp/Kokoro model and binary licenses, hashes, size, provenance, packaging, CPU/GPU/RAM/latency, update/removal, and privacy must pass before an explicit user-approved installation. No silent download.

Experimental lab: Kyutai Moshi is evaluated separately for full-duplex overlap/backchannels. It never replaces Codex/Claude reasoning or inherits tool authority and cannot ship without Mac/Windows performance, package, license, privacy, barge-in, and resource gates.

## P3 — CrisperWhisper meeting-transcription lab

CrisperWhisper is only an opt-in high-fidelity post-meeting transcription candidate, never the low-latency live voice path. Inspect the exact repository/model license and access conditions before execution. Compare it through a versioned, consented local fixture suite against already-local alternatives for word accuracy, timestamps, latency, RAM/CPU/GPU, package behavior, failure recovery, and model size/provenance.

Acceptance:

- No implicit Hugging Face login, model download, network request, or cloud transcription. Missing capability remains explicit and manual transcript review remains available.
- Candidate output is draft/uncertain until reviewed; it cannot silently create memory, commitments, or speaker identity.
- Meeting source/audio/transcript ownership, hard deletion, workspace isolation, backup/restore, and optional sync policy remain intact.
- Production adoption requires explicit model-install approval plus clean dependency/license/security and native Mac/Windows package gates.

## P4 — opt-in whole-device activity capture

Create a Recall-style local capture subsystem as a separate, default-off capability. The user explicitly chooses the workspace and starts capture. A globally reachable pause/resume indicator and kill switch must stop new capture immediately. Per-app/bundle/process exclusions are evaluated before persistence; sensitive/system surfaces are excluded conservatively. Capture uses bounded snapshots plus searchable local metadata, never covert continuous recording.

Acceptance:

- Clear permission/onboarding disclosure, persistent active indicator, instant global pause, per-app exclusions, preview-before-enable, storage meter, configurable rolling retention, and delete-now controls.
- Provenance records device, display/app identity, time, capture policy/version, exclusions decision, source hash, derived OCR/index model, and retention deadline without leaking content into activity logs.
- Default local-only encrypted-at-rest storage; no cloud or peer transfer. User separately chooses whether encrypted capture sync is allowed per workspace/device and sees size/bandwidth consequences.
- Retention expiry and explicit deletion hard-delete snapshots, thumbnails, OCR, embeddings, relationships, activity-derived memory, backups under documented retention, relay payloads, and peer replicas without resurrection.
- Tests cover pause/exclusion races, app identity changes, lock/login/password fields, multiple monitors, sleep, low disk, crashes, retention clock/DST, malformed frames, indexing unavailable, backup/restore, and deletion.

Authority gates: macOS screen-recording permission is per-device and explicit. Windows capture needs native hardware verification. Employer-managed devices/apps/data require employer authorization. Encrypted sync activation waits for V1 and a capture-specific bandwidth/retention/deletion review.

## P5 — polished cross-device command and agent control

Add a product flow for choosing **this device**, an explicit preferred trusted peer, or **automatic eligible device**. Routing policy considers online health, model/tool capability, free memory/storage, workspace data policy, security profile, cost class, and user preference. Every remote command uses a target-issued finite lease bound to workspace, execution, profile digest, capability set, epoch, expiry, and cancellation channel. Failover is off by default and never crosses provider/device/data policy silently.

Acceptance:

- Device picker/status shows why eligible/ineligible, preferred device, lease/queue/run state, route explanation, expected fallback, cancel/revoke, and target-local approval requirements.
- Local simulator proves lease issue/renew/expiry/replay/revocation, duplicate commands, target restart, lost response, offline queue, preferred-device recovery, safe failover/no-failover, cancellation, attachment resumption, and content-minimized audit.
- Target device revalidates profile, roots, tools, model, secrets, budgets, workspace epoch, and current revocation; relay/client cannot widen authority.
- Peer embedding work uses the same policy boundary: capability/memory/availability/workspace permission/preference select the worker, provenance identifies device/runtime/model, and local fallback or explicit unavailable state is deterministic.

Activation gate: real peer execution waits for V1 convergence/security evidence and explicit user approval of eligible devices, fallback, leases, unattended categories, and data transfer. Physical two-Mac and Mac↔Windows runs remain required before release claims.

## P6 — multi-provider/model and multi-agent orchestration

Extend the existing local Codex/Claude registry and one-child foundation into explainable orchestration. A planner proposes provider/model/device/profile per task from capability, input type, latency/quality, health, privacy, and cost policy. Provider/model handoff carries only an explicit bounded context artifact and provenance; it never silently changes data boundary. Parallel adversarial review is a named orchestration pattern with independent outputs, severity-rated synthesis, repair request, and final verdict.

Acceptance:

- Automatic selection is reproducible and visible, with user override, explicit no-route, fallback off by default, and no cross-provider/device/account fallback without policy.
- Typed agent DAGs have finite depth/fan-out/concurrency/duration/output/cost, least-context inheritance, target-profile enforcement, durable lineage, cancellation propagation, retry/idempotency, crash recovery, and terminal status.
- Handoff tests cover partial streams, stale/auth-expired CLI, incompatible attachments, provider loss, conflicting reviews, poisoned child output, cancellation/failover races, and deletion/backup/sync of lineage.
- No new API credential, paid call, remote device, autonomous external action, or unattended expansion is enabled in the local slice.

Authority gates: every new provider/API/model/device/cost budget and unattended pattern is separately approved. OpenAI embedding comparisons still require a supplied API key plus explicit data/cost authorization and identical suite provenance.

P6 is implemented in two ordered sub-slices: **P6A policy-bounded paired provider evaluation**, then **P6B model-neutral Tool Gateway / Agent Runtime**. Their implementation-ready acceptance, local-CLI-first developer tooling policy, trusted-workspace terminal/commit policy, and selectable browser-profile boundary are canonical in `outputs/TOOL_GATEWAY_ORCHESTRATION_PLAN.md`. The local slice may build schemas, policy simulation, hostile fixtures, and no-effect UI; it does not activate Kimi K3, DeepSeek V4 Flash, OpenRouter, an API key, an external account, browser session, cross-device execution, PR, or deployment.

## P7 — unified calendar and meeting copilot

Build local canonical calendar/event/attendee/source-account contracts, fixture adapters, timezone/DST recurrence normalization, conflict/free-busy projection, agenda/meeting-prep suggestions, explicit note linking, and post-meeting review prompts. It remains chat-first: ask about the day, prepare a meeting, or open the optional calendar/meeting view. Fixture events cannot masquerade as real account data.

Acceptance:

- Multi-calendar identity, timezone/DST, recurrence exceptions, cancellation, duplicates, stale cursor, missing/offline source, conflicts, private-event redaction, and deletion mappings pass with synthetic fixtures.
- Meeting copilot shows why each source is included; drafts agenda/questions/notes only; preserves consent and transcript-review boundaries; and cannot auto-join, record, send, schedule, or modify an event.
- Canonical events, notes, transcripts, suggestions, relationships, activity, indexes, sync, backup, and hard deletion retain exact account/source provenance and workspace policy.

External gate: Microsoft 365 requires a user-approved app registration, exact tenant/account/workspace, minimal scopes, token custody, retention/model/sync choices, and employer approval where applicable. Reads precede durable ingest; draft precedes write; each send/event modification/background refresh is separately activated and provider-confirmed.

## E1 — connector and secure public-ingress program

Activate providers one at a time in this order: Outlook/calendar read-only; email/Teams read-only plus draft-only; Azure DevOps read-only plus draft actions; explicit writes; signed public webhooks. Shared requirements are protected OAuth/token references, named tenant/account, minimum scopes, incremental cursors, idempotency, rate/backoff, revocation, deletion/export mapping, prompt-injection quarantine, preview/approval, and observable pause/kill/dead-letter status.

For developer/work-item systems with a supported installed CLI, the first implementation path is the policy-governed local CLI adapter under the user's existing local identity; do not duplicate OAuth/PAT custody. Direct provider APIs/connectors remain a later fallback when no suitable CLI exists or an explicitly approved requirement demands one. External webhook registration still requires authority over the target account/tenant and endpoint permissions even when Waypoint-side channel configuration is automated.

No account connection, app registration, employer/client data, credential, public endpoint, network exposure, background schedule, send/write, or external retention is authorized by this plan. Each provider must pass fixture → authorized sandbox → limited authorized account gates with separate security/privacy review.

## P8 — local memory consolidation and reflection

Borrow the useful pattern of Anthropic Managed Agents “Dreaming” without adopting its managed preview API. Waypoint’s slice stays subscription-first and invokes only an already signed-in local Codex or Claude Code CLI under the existing bounded execution/security profile. A user explicitly starts a workspace-scoped reflection over a bounded, visible source selection. The result is a new proposed revision set; it never overwrites canonical memory, notes, rules, relationships, or source content.

Acceptance:

- The review surface shows exact source IDs, revisions/digests, workspace, provider/CLI/version, prompt/policy version, budget, omissions, and per-proposal rationale. Cross-workspace or cross-client source selection fails closed.
- Proposals identify duplicates, stale claims, and contradictions without silently choosing a winner; they may suggest merges, supersession, relationship edges, or learned rules, but every item supports diff, accept, edit, reject, and accept-selected controls.
- Acceptance revalidates every source digest and policy immediately before an atomic write. Changed/deleted sources make the proposal stale. Source deletion cascades through owned proposal evidence and invalidates or deletes accepted derivatives under the existing provenance rules; no orphaned assertion survives as current truth.
- Original source memory is immutable through the reflection path. Accepted revisions retain rollback lineage; rejection and rollback are durable and auditable. Backup/restore, hard deletion, sync schema, workspace isolation, interruption, crash recovery, cancellation, and bounded queue/output/runtime behavior pass adversarial tests.
- Status visibly distinguishes queued, reviewing, proposed, stale, accepted/edited, rejected, rolled back, cancelled, failed, and killed. Audit and activity records remain content-minimized. The existing workspace/global kill and execution budgets dominate provider invocation.
- Missing or signed-out CLIs produce a truthful unavailable state. No Anthropic/OpenAI API credential, managed-agent service, external account/data, model download, network service, or background execution is introduced.

Later activation gate: scheduling and any narrowly defined low-risk auto-apply require separate user authorization, source categories, cadence/quiet hours, retention, finite budgets, notification/review policy, false-merge/contradiction thresholds, kill behavior, rollback drill, and an independent privacy/correctness review. The initial slice is explicit-run and review-required only.

## M1 — mobile companion

After V1, decide iOS/Android order and prototype a narrow companion: explicit device enrollment/revocation, protected keys, encrypted bounded cache, quick text/photo/file capture, offline queue, conversation/search/briefing/commitment review, approve/reject/cancel, and privacy-redacted notifications. Desktop/relay remain the execution authority; mobile is not an unrestricted credential or agent broker.

Acceptance before beta includes stolen/rooted device, biometric/app lock, OS backup/screenshot/clipboard/share sheet, deep-link/file attacks, offline conflict/delete convergence, low storage, transfer interruption, notification duplication/leakage, upgrade compatibility, accessibility, battery/network budgets, and truthful store disclosures.

Authority gates: platform order, minimum devices/OS, cache/biometric/cellular policy, allowed workspaces/accounts, MDM rules, developer/store accounts, push credentials, physical devices, beta distribution, and publishing.

## V1 — deferred but mandatory sync validation

After P1–P8 safe local slices that remain eligible, run two isolated production app-data roots/processes through the live relay, then two physical Macs. Cover enrollment/revocation/rotation, chats/messages, attachments/resume, document source/chunk rebuild, graph/commitments/rules/activities/meetings/triggers/reflection proposals/capture-policy data, concurrent conflicts, offline work/delete, outage/recovery, re-enrollment, and anti-resurrection. Capture files/audio remain unsynced unless their explicit per-feature sync choices were approved.

Mac↔Windows repeats the matrix on supported hardware before cross-platform release readiness. Simulation is useful evidence but never substitutes for physical-device, Windows, signing, update, connector, public-ingress, or mobile gates.

## Stop rules

Stop for explicit authority before accessing an account or work/client data; creating app registrations, DNS, TLS identities, secrets, cloud resources, or public listeners; downloading/installing models; sending/writing externally; enabling schedules or unattended actions; widening peer/provider data policy; distributing/publishing; or changing encryption, retention, deletion, or recovery guarantees. Safe local fixtures, contracts, UI, tests, and simulators may continue only when they cannot be mistaken for activated capability.
