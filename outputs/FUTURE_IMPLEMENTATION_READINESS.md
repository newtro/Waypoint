# Waypoint future implementation-readiness plan

## Purpose and scope

This is the canonical order for work deferred beyond the current-Mac local build. It converts product intent into phase gates without authorizing implementation, deployment, account connection, credential use, or third-party data ingestion. Existing object ownership, hard deletion, workspace isolation, local-first operation, signed-in CLI integration, opaque-relay direction, and Docker-free native clients remain invariants.

The post-document-ingestion completion sequence and newly reconciled product streams are specified in `outputs/ROADMAP_COMPLETION_ADDENDUM.md`. Where this older R0–R6 decomposition is broader, the addendum controls slice ordering and safe-local versus authority-gated activation.

Every implementation phase must use the build → verify → independent adversarial review → repair → re-verify loop. A phase advances only when its acceptance criteria pass and no blocker/high-severity finding remains. Platform or external-environment evidence must be labeled honestly; a simulation cannot satisfy a real-network, Windows, or provider gate.

## Non-negotiable boundaries

- The desktop database is authoritative for local use; relay or provider failure must not block ordinary local work.
- Workspace content is end-to-end encrypted before it reaches the sync relay. The relay receives only the documented minimum delivery/enrollment metadata and never CLI, account, or model credentials.
- Workspace, account, device, and employer-tenant boundaries are explicit. Data never crosses them by convenience or model inference.
- Every derived memory, summary, commitment, transcript, index entry, rule, notification, and remote replica retains provenance and participates in the owning root's deletion lifecycle.
- Background actions are visible, bounded, revocable, idempotent where applicable, and governed by a named security profile. Draft/read authority never implies send/write authority.
- Native macOS and Windows operation cannot require Docker. A future optional sandbox backend cannot become a setup, build, test, or runtime prerequisite.
- OpenAI embedding comparisons require a user-supplied API key and explicit cost authorization. No ordinary LLM API becomes a prerequisite for the signed-in Codex/Claude CLI architecture.

## Readiness map

| Order | Phase | Present starting point | Exit evidence |
|---|---|---|---|
| R0 | Authority and protocol freeze | Mac-local foundations and threat model | Approved trust, retention, support, and recovery decisions |
| R1 | Real secure sync relay | Listener-free opaque relay simulation | Hardened Ubuntu/AWS node and real Mac↔Mac two-peer matrix |
| R2 | Windows and cross-platform release | Current-Mac unsigned package | Native Mac↔Windows matrix, signed installers, staged update/rollback evidence |
| R3 | Second-brain experience | Durable chats/documents/memories/activity | Briefing, commitments, memory suggestions, timeline, and audio vertical slices |
| R4 | Proactive intake and automations | Safe connector/setup seams only | Authorized connector-by-connector read/draft/write gates and scheduler/playbooks |
| R5 | Multi-provider/model and multi-agent work | Visible local CLI routing and bounded lineage | Policy routing, capability negotiation, budgets, approvals, and recovery |
| R6 | Mobile companion | Desktop-first architecture | Narrow capture/review companion validated before any wider authority |

R3 may develop against local fixtures after R0 while R1–R2 run, but release of synced derived data depends on R1/R2. R4 depends on the R3 provenance/lifecycle model and R5 execution policy. R6 depends on the production enrollment/sync/key lifecycle from R1 and compatible release policy from R2.

## R0 — authority, trust, and protocol freeze

### Dependencies and decisions

- Freeze node-visible metadata, protocol/schema support windows, tombstone/peer-expiry policy, workspace-key rotation and recovery, relay backup posture, and binary size/retention limits.
- Select supported macOS/Windows versions and architectures, Ubuntu LTS versions, release channels, update rollback window, and minimum hardware.
- Define personal-account versus employer-tenant policy, including whether work data may enter a personal workspace at all.
- Threat-model connector ingress, audio consent, notifications, mobile loss, model fallback, prompt injection, and unattended execution.

### Acceptance and tests

- Architecture decision records map every secret, plaintext/ciphertext field, retention owner, deletion path, and recovery artifact.
- Protocol fixtures cover version negotiation, key epochs, replay, revocation, backup recovery, and deletion dominance.
- A privacy review and independent security review have no unresolved blocker/high finding.

### Required user decisions

- Approve node region/account/cost ceiling, metadata exposure, recovery method, peer expiry/tombstone rule, backup retention, support matrix, and release identity.
- Separately decide whether any employer-managed data is permitted and under whose policy.

## R1 — real secure Ubuntu/AWS relay and two-peer validation

### Scope

1. Build a native, non-Docker Ubuntu service/package from the reviewed protocol foundation.
2. Add least-privilege service identity, TLS, authenticated enrollment, one-use invitations, device listing/revocation, key-epoch rotation/re-wrapping, quotas, durable opaque queues, attachment resumption, health, backup, and bounded logs.
3. Provision a non-production user-owned AWS/Ubuntu environment only after authorization; document DNS, firewall, patching, storage encryption, restore, and teardown.
4. Validate Mac↔Mac first, then feed the same matrix into R2 for Mac↔Windows.

### Data/privacy boundary

- Content, filenames, object IDs, prompts, hashes, workspace keys, account tokens, and execution output remain encrypted or local. Relay logs contain opaque identifiers, sizes, timing, protocol state, and content-free errors only.
- Enrollment grants sync to one workspace; peer execution is a separate target-approved capability. Revocation stops future access but cannot erase plaintext already present on a lost peer.
- Key rotation is resumable and must not silently strand an offline authorized peer. Re-enrollment after tombstone safety expiry starts from a fresh snapshot.

### Acceptance and tests

- Automated protocol/property tests cover tamper, replay, reorder, duplicate delivery, quotas, incompatible versions, expired invitations, revoked devices, key-epoch change, clock skew, and relay restart.
- Real two-peer tests cover online/offline concurrent edits, ordered messages, graph mutations, large interrupted attachments, conflicts, deletion while a peer is offline, revocation, re-enrollment, and node outage/recovery.
- Deletion converges without resurrection; relay payload and backup inspection finds no representative plaintext; all transfer integrity failures fail closed.
- Restore drill rebuilds the relay from documented backup without client data loss or credential leakage. Health/diagnostics remain content-minimized.
- Native Ubuntu install/upgrade/rollback/uninstall, least-privilege hardening, dependency audit, load/soak, disk exhaustion, and disaster recovery pass.
- Independent protocol/security review is clean; professional cryptographic review remains a production-release gate unless the design adopts a separately reviewed standard protocol unchanged.

### Authorization gate

Requires explicit user authority for AWS spend, host creation, region, domain/DNS, TLS, firewall exposure, credentials, backup target, and teardown. No employer network or tenant may be used without employer authorization.

## R2 — Windows delivery and cross-platform release readiness

### Scope

1. Establish a clean supported Windows machine/CI runner and validate native install, package, launch, filesystem permissions, SQLite/object-store behavior, CLI discovery/process cancellation, protected key storage, accessibility, performance, and uninstall data choices.
2. Validate Mac↔Windows sync and peer execution against the R1 node, including target-local security enforcement and mixed client versions.
3. Add platform release identity, code signing, Apple notarization, Windows signing, staged update manifests, signature verification, downgrade prevention, rollback, and release provenance/SBOM.

### Data/privacy boundary

- Private keys use Keychain/DPAPI or another approved protected store; no plaintext fallback or synchronized credential material.
- Updates are signed, integrity checked, rollout controlled, and independent of workspace content. Diagnostics/upload remain opt-in and content-minimized.
- Uninstall distinguishes application removal from explicit workspace deletion; neither is ambiguous or silently destructive.

### Acceptance and tests

- Supported OS/architecture matrix passes install, first launch, upgrade from every supported predecessor, rollback, damaged update, offline use, low disk, long paths, Unicode, antivirus interference, sleep/resume, crash recovery, and uninstall/reinstall.
- Signed/notarized artifacts validate on clean machines; update signatures, channel isolation, rollback window, protocol compatibility, and compromised-channel behavior pass.
- Mac↔Windows convergence, revocation, deletion, attachment, peer execution/cancel, and backup/restore matrices pass on physical target hardware.
- Accessibility keyboard/screen-reader/zoom and performance budgets pass natively. Dependency audit, licenses, reproducible-build evidence, SBOM, and independent release/security review are clean.

### Authorization gate

Requires Apple Developer and Windows code-signing identities, certificate/key custody decisions, release organization identity, update hosting/channel authority, and explicit permission before publishing or distributing any artifact. Windows verification requires an available supported Windows machine.

## R3 — first-class second-brain experience

### Ordered slices

1. **Commitments and memory suggestions:** derive candidate facts, decisions, people, projects, dates, and commitments from conversation; show source spans, confidence, workspace, and accept/edit/reject controls. Default to suggestions, not silent permanent memory.
2. **Daily briefing:** locally compose a reviewable briefing from durable workspace content and authorized sources, with why-included provenance, freshness, omissions, and no automatic external send.
3. **Knowledge graph and learned rules:** expose navigable relationships and suggest versioned rules from repeated user corrections. Rules require approval, scope, dry run, disable/revert, and outcome history.
4. **Activity timeline:** unify content, execution, sync, rule, automation, meeting, and deletion events without duplicating sensitive bodies.
5. **Audio-only meeting capture:** explicit recording state/consent reminder, local capture, bounded transcription, speaker uncertainty, review-before-memory, artifact retention, export, and cascade delete.

### Data/privacy boundary

- Inference is not truth: suggested memory/commitments display provenance and confidence. Rejection is recorded minimally and does not become a hidden profile.
- Briefings and rules respect workspace and account boundaries and identify stale/missing source state. Private content is not copied into activity events.
- Audio never records covertly, defaults local, exposes retention/storage size, and is not uploaded or synced until separately enabled. Jurisdiction and participant-consent obligations remain the user's responsibility and must be explained.

### Acceptance and tests

- Versioned representative fixtures measure extraction precision/recall, false commitments, source traceability, duplicate merging, temporal updates, contradiction handling, and rejection behavior.
- Every derived object can trace to exact source revisions; source edit/delete invalidates, updates, or deletes it under documented ownership rules.
- Briefings tolerate missing/offline sources and never imply completeness. Timezone/day-boundary/DST, recurring items, dismissed items, and stale source tests pass.
- Rule dry-run and rollback produce deterministic, auditable outcomes; no learned rule grants new privileges.
- Audio tests cover device loss, permission denial, interruption, long recording, disk pressure, malformed media, transcript correction, consent UX, sync opt-out, export, and hard deletion.
- User-flow, accessibility, performance, privacy, destructive lifecycle, and independent adversarial review gates pass for every slice.

### User decision gates

- Approve auto-suggestion thresholds and whether any category may auto-save; briefing schedule/delivery; rule-learning scope; audio retention, sync, transcription runtime, speaker handling, and consent language.

## R4 — proactive intake, schedules, playbooks, and connectors

### Architecture first

- Define a connector SDK with account/tenant identity, declared scopes, read/draft/write capability separation, encrypted token references, incremental cursor, idempotency key, rate-limit/backoff, revocation, deletion/export mapping, and fixture/replay mode.
- Define versioned schedules/playbooks with timezone/DST semantics, dry run, permission snapshot, concurrency/budget limits, retry/dead-letter policy, pause/kill switch, approval steps, and content-minimized audit.
- Define signed webhook ingress with per-source secrets, replay window, idempotency, schema validation, payload limits, quarantine, and visible routing policy.

### Connector order

1. Local fixture connector and scheduler/playbook engine.
2. Calendar/Outlook read-only normalization and briefing preview.
3. Email/Teams read-only intake and draft-only outputs.
4. Azure DevOps read-only work-item/activity intake and draft actions.
5. Explicit per-action calendar/email/Teams/DevOps writes.
6. General signed webhooks after ingress hardening and operator controls pass.

### Data/privacy boundary

- Personal and employer accounts are separately named boundaries. Cross-account correlation, copying into a workspace, training/learning, sync, retention, and deletion each require declared policy.
- OAuth tokens stay in OS-protected storage and never enter chats, logs, sync payloads, CLI environments, backups, or model prompts. Minimum scopes only; refresh/revoke behavior is visible.
- Read does not imply durable ingest; ingest does not imply model access; draft does not imply send; a schedule does not inherit future expanded permissions.
- External deletion cannot be claimed unless the provider confirms it; Waypoint deletion always purges its owned copies/derivatives and records the external residual honestly.

### Acceptance and tests

- Contract tests use synthetic fixtures and provider sandboxes only after authorization; no production data is required for development.
- Scope escalation, wrong tenant, token expiry/revocation, pagination, duplicate/out-of-order events, webhook replay/forgery, rate limits, partial failure, DST, missed schedules, retries, dead letters, and kill switch pass.
- Prompt-injection fixtures prove external content cannot grant authority, widen scopes, trigger sends, or alter security policy.
- Every intake item shows source account/tenant, received time, sync state, transformation/model provenance, and deletion/retention state.
- Write actions default to preview/approval, are idempotent, and expose provider-confirmed outcome. Independent connector/security/privacy review is clean before each capability advances from fixture → sandbox → limited real account.

### Authorization gates

- Each provider requires a separate user choice of account, tenant, scopes, workspace, retention, model access, background schedule, and write authority.
- Employer-managed Microsoft 365/Teams/Outlook/Azure DevOps data requires employer administrator/policy approval where applicable; absence of that approval is a hard stop, not a test inconvenience.
- App registrations, secrets, webhook endpoints, production tenants, and real data are forbidden until explicitly authorized. Sending, modifying calendar events, posting to Teams, or changing DevOps items requires an additional write-action gate.

## R5 — multi-provider/model routing and multi-agent execution

### Scope

- Evolve the provider registry around capability negotiation, supported input types, model/version provenance, context and output limits, local/peer availability, cost class, privacy class, and health—without assuming ordinary APIs.
- Keep signed-in Codex and Claude Code CLIs primary. Add local model/runtime providers or optional API providers only through separately authorized adapters.
- Add policy-driven routing with an explainable proposed route, explicit fallback order, execution device, security profile, data eligibility, budget, and user override.
- Extend bounded agents to typed tasks, finite depth/concurrency/runtime/token-or-cost budgets, parent/child artifacts, approval boundaries, cancellation propagation, recovery, and deterministic terminal status.
- Implement provider A/B comparison and the model-neutral Tool Gateway through the canonical `outputs/TOOL_GATEWAY_ORCHESTRATION_PLAN.md`: a trusted-main-process policy point, shared UI/AI domain commands, local-CLI-first developer tooling, visible trusted-terminal/browser-profile policy, normalized receipts, and explicit provider/network/credential/PR/deployment activation gates.
- Integrate the swappable embedding/chunking benchmark and future trusted peer embedding worker through the same device/data-policy model.

### Data/privacy boundary

- A fallback never sends data to a different provider, device, region, or account without prior explicit policy. Capability mismatch fails truthfully.
- Child agents receive the minimum scoped context and cannot inherit broader roots, secrets, network, connectors, or write authority than the parent and target security profile allow.
- Provider output and delegated-agent results are untrusted data. Full prompts/raw output follow chat retention, not activity-log duplication.
- Costs, quotas, and external API use are disabled unless explicitly configured and authorized.

### Acceptance and tests

- Capability/fallback matrices cover missing/stale/auth-expired CLIs, unsupported attachments, provider timeout, partial stream, malformed output, device loss, cancellation race, retry, and no-eligible-route.
- Policy tests prove workspace/account/region/provider constraints cannot be bypassed by fallback or delegation. Routes and every child lineage are reconstructable from content-minimized provenance.
- Adversarial agents cannot escalate profiles, exfiltrate secrets, recursively delegate past limits, conceal tool use, duplicate side effects, or continue after cancel/revocation.
- Evaluation uses versioned task suites for quality, latency, resource use, failure recovery, and—only when authorized—cost. Embedding/chunking indexes retain provider/model/policy provenance and reversible reindexing.
- Independent model-security and orchestration review is clean before unattended execution is enabled.

### User decision gates

- Approve allowed providers/models/devices, local-versus-peer preference, provider data policy, permitted fallback, budgets, unattended categories, approval cadence, and any API credentials/costs. OpenAI embedding API comparison remains optional and separately cost-authorized.

## R6 — mobile companion strategy and phased scope

### Product boundary

Mobile begins as a companion, not a peer-equivalent execution host:

1. **Design/prototype:** platform choice, encrypted local cache, device enrollment/revocation, notification privacy, background limitations, accessibility, and app-store policy review.
2. **Capture/review:** quick text/photo/file capture, inbox triage, chat/history read, briefing/commitment review, search, and approve/reject suggestions. Offline capture queues safely.
3. **Conversation/notifications:** bounded chat through an authorized online desktop/relay route, actionable notifications, and cancel/approval controls.
4. **Later consideration:** audio capture or broader execution only after separate privacy, battery, background, and store-policy gates. Mobile never silently becomes a credential or unrestricted execution broker.

### Data/privacy boundary

- Device enrollment is explicit; keys use platform protected storage; lock-screen notifications redact content by default; remote revocation stops future sync but cannot erase already viewed information without OS support.
- Cache scope, retention, biometric/app lock, screenshot/backup behavior, cellular transfer, and attachment download are user-controlled. Mobile backups must not leak workspace keys/content.
- Capture provenance includes device, workspace, timestamp, and upload state. Delete/tombstone behavior matches desktop and prevents offline resurrection.

### Acceptance and tests

- Threat model covers stolen/rooted device, malicious deep links/files, notification leakage, clipboard/share sheet, OS backup, background termination, replay, and certificate pin/transport tradeoffs.
- Physical-device matrix covers enrollment/revocation, offline capture/convergence, conflicts, delete while offline, biometric lock, low storage, interrupted transfer, push delay/duplication, upgrade/rollback compatibility, accessibility, and battery/network budgets.
- App-store privacy disclosures match observed behavior. Independent mobile security/privacy and lifecycle review is clean before beta.

### User decision gates

- Choose iOS/Android order, minimum OS/devices, distribution channel, notification service, biometric/cache policy, mobile data limits, allowed workspaces/accounts, and whether employer mobile-device-management requirements apply. Store accounts, push credentials, publishing, and real-device distribution require explicit authorization.

## Cross-phase evidence and stop rules

Each phase must maintain a traceability table from acceptance criterion to automated test, physical/manual check, review finding, repair, and residual risk. Required common checks are workspace isolation, hard deletion and backup retention, accessibility, migration/rollback, bounded resource use, offline/failure recovery, content-minimized diagnostics, dependency/license/SBOM review, native packaging, and security/privacy review.

Stop and request a decision when work would change the encryption/trust model, ingest employer or third-party data, create an account/app registration, expose a public endpoint, spend money, use a credential, send/write externally, publish/distribute software, widen autonomous authority, or weaken deletion/retention guarantees. Independent fixture-based planning and local implementation may continue around a blocked external gate when it cannot misrepresent the missing evidence.
