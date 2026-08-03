# Waypoint decision log

## Settled product decisions

| Decision | Status | Consequence |
|---|---|---|
| Electron + TypeScript + React | Settled | One desktop application stack targets macOS and Windows. |
| Desktop first | Settled | Mobile is a later companion, not an MVP peer. |
| Mac and Windows are peer clients | Settled | Both retain useful local state and can perform authorized work. |
| User-hosted Ubuntu/AWS coordination | Settled direction | Setup, operations, identity, encryption, and recovery must be productized. |
| Signed-in Codex and Claude Code CLIs | Settled | Build versioned CLI adapters; do not assume ordinary LLM APIs. |
| Local embeddings | Settled | Indexing, versioning, hardware compatibility, and deletion are client concerns. |
| Durable chats, documents, and memory graph | Settled | They share a canonical object/lifecycle model. |
| True cascade deletion | Settled | Derived data, sync replicas, queues, and graph edges are included. |
| Personal-first workspaces | Settled | Team/organization administration is outside the MVP. |
| Visible routing and orchestration | Settled | Model, device, agent lineage, status, and permissions are user-facing. |
| Security profiles | Settled | Execution is constrained by named, inspectable capability bundles. |
| Activity timeline | Settled | Meaningful content, AI, sync, device, and security events are visible. |
| Peer-device execution | Settled | Target-device authorization and enforcement are mandatory. |
| Native guided onboarding | Settled | Data location, CLI state, node setup, and permissions are explained in-product. |
| Audio-only recorder, webhooks, calendar | Planned later | Preserve boundaries; exclude full functionality from MVP. |
| Schedules, playbooks, sandboxing, health, backup | Planned | MVP includes only the minimum trust/recovery baseline it needs. |
| User-controlled data boundaries | Settled principle | Storage, sync, encryption, retention, and execution location stay inspectable and controllable. |
| No required Docker dependency | Settled | Build, test, setup, and runtime use native macOS/Windows paths; Docker may only be an optional future sandbox backend. |
| Windows verification is platform-contingent | Settled by user | Windows-only build/package/launch/update/filesystem/process checks are mandatory when work moves to Windows and do not block Mac phases. |

## Working assumptions to validate

1. The first users can operate a guided user-hosted node or accept a supported deployment recipe.
2. Installed CLI behavior is stable enough to support through versioned adapters and compatibility checks.
3. Local embedding quality and latency are acceptable on the oldest supported desktop hardware.
4. Personal-first object ownership can remain simple without blocking future sharing.
5. The activity timeline can be useful without retaining sensitive content redundantly.
6. Peer execution provides meaningful value in the MVP rather than merely architectural completeness.

## Open decisions required before build commitment

### Data and encryption

- Is coordinator-held content end-to-end encrypted so the node cannot decrypt it, or is server-side plaintext processing ever required?
- What metadata is visible to the node?
- Where are workspace keys generated, stored, rotated, recovered, and revoked?
- What is the tombstone retention rule, especially for long-offline peers and backups?
- Are attachments content-addressed, and what deduplication privacy tradeoffs are acceptable?

### Sync and storage

- Which local database and migration strategy fit Electron on both platforms?
- Which conflict model is used for documents, messages, graph edges, and metadata?
- Is server state a relay log, encrypted replica, backup, or some combination?
- What are supported object and workspace size limits for MVP?
- Are embeddings recomputed per device or synced when model versions match?

### CLI integration

- Which minimum/maximum Codex and Claude Code CLI versions are supported initially?
- Which model identity and sub-agent events can be reliably observed from each CLI?
- How does Waypoint distinguish an unavailable feature from an adapter parsing failure?
- Which working-directory, environment, and credential inheritance policies are safe defaults?

### Security and peer execution

- What OS mechanisms enforce profiles on macOS and Windows in MVP?
- Which actions require per-run approval versus durable authorization?
- How are peer requests authenticated, queued, canceled, and protected from replay?
- What resource budgets limit orchestration depth, concurrency, runtime, disk, and network use?

### Product behavior

- What is the MVP document editing format: plain text/Markdown, structured rich text, or both?
- Which attachment types receive previews, extraction, or indexing?
- Are memories exclusively user-curated, automatically proposed, or automatically persisted under policy?
- What graph relationships are user-visible and editable?
- What minimal backup destination and restore experience qualifies for MVP release?

### Distribution and operations

- What OS versions and CPU architectures are supported?
- How are desktop and node updates signed, staged, rolled back, and kept protocol-compatible?
- Is the Ubuntu/AWS node installed through a native package, infrastructure template, or multiple supported non-Docker paths?
- What diagnostics may leave the device, and what is strictly opt-in?

## Recommended decision sequence

1. Define object ownership, deletion, and retention semantics.
2. Choose encryption posture and coordinator trust boundary.
3. Prototype CLI adapters and confirm observable routing/orchestration data.
4. Prototype local storage, embeddings, and sync conflicts together.
5. Define security-profile enforcement and peer execution protocol.
6. Lock the supported platform/version matrix.
7. Finalize onboarding, backup baseline, and release criteria.

## Change-control convention

When a decision changes, record the date, prior choice, new choice, reason, and affected milestones. Do not silently rewrite a settled decision whose consequences have already shaped implementation or user expectations.

## Phase 2 implementation decisions (2026-08-03)

- Default AI execution is read-only, tool-free, local-only, explicitly approved, single-concurrency, and bounded to two minutes. Broader named profiles require a later deliberate product decision.
- Prompts travel over child stdin, never process argv. CLI OAuth remains owned by the signed-in CLI; only `HOME`, `USER`, `PATH`, `LANG`, and `NO_COLOR` are inherited, and Waypoint does not inspect or persist CLI credentials. `USER` is required for Claude Code to resolve its macOS sign-in state.
- AI subprocesses run from a dedicated per-workspace execution directory beneath the app data root, never from the shared database/attachment directory. This preserves workspace isolation while avoiding a Docker dependency.
- Run provenance stores a prompt digest rather than duplicating prompt content. The durable user message remains the content owner, and deleting its chat cascades run/events.
- Phase 2 child lineage is limited to one child depth. Recursive autonomous delegation and peer execution remain outside this phase.
- The renderer starts a run and receives its ID immediately; terminal persistence continues in the main process so cancellation and status polling remain available.

## Whole-product integration decisions (2026-08-03)

- Sync journaling is part of the canonical SQLite transaction so a content write cannot commit without its local propagation intent. Renderer status is aggregate-only; plaintext mutations, clocks, keys, device IDs, and encrypted envelopes never cross IPC.
- The current build does not create keys, enroll devices, or contact a node. Readiness and Settings expose the exact local-only boundary and Docker-free setup handoff until the user separately authorizes external configuration.
- Supported local CLI windows are explicit: Codex `>=0.146.0 <1.0.0` and Claude Code `>=2.1.220 <3.0.0`. Unsupported versions remain visible with update guidance and cannot start silently.
- Existing documents autosave after 900 ms through serialized durable revisions. Pending drafts must flush before navigation or deletion of their own document; a failed flush blocks the transition and remains retryable.

## Phase 3 local-foundation decisions (2026-08-03)

- `libsodium-wrappers-sumo` is pinned at `0.8.4` behind a small main-process-only facade. The official portable JS/WASM build avoids native-addon and Docker requirements. Only Ed25519 signatures, X25519 sealed key wrapping, XChaCha20-Poly1305 authenticated encryption, Argon2id recovery derivation, secure randomness, and constant-time comparison are allowed. This choice inherits reviewed primitives but is not a claim that the Waypoint protocol itself has received a professional audit.
- The coordination node remains an opaque durable relay. R0 supersedes this provisional metadata list with the per-surface contract in `implementation/R0_PROTOCOL_FREEZE_DECISIONS.md`: protocol v1 has no envelope-type or delivery-cursor field. Delivery sees bounded random opaque IDs, epoch/sequence, size, and timing; enrollment additionally sees applicant public keys, request/approval signatures, membership epoch, and wrapped-key ciphertext; presence, acknowledgements, and encrypted backup metadata are separately enumerated. Workspace names, object identifiers, bodies, filenames, hashes, prompts, CLI credentials, local paths, raw execution output, private keys, recovery passphrases, and plaintext workspace keys stay encrypted or local.
- Device enrollment is explicit, workspace-scoped, expiring, one-use, and approved by an active owner device. Revocation advances membership epoch and stops delivery and execution; it cannot erase data already decrypted on a lost device. Production workspace-key rotation/re-wrapping orchestration remains part of the real-node gate and is not claimed by the local registry foundation.
- Concurrent document and memory bodies preserve recoverable variants. Append-only messages converge by stable identity. Metadata uses deterministic clock/device ordering only where it cannot discard authored content. Deletion dominates every stale or concurrent update to the same identity; restore creates a new identity.
- Tombstones remain at least 90 days and until every active peer acknowledges them. A long-offline peer must be revoked before purge and must re-enroll from a fresh snapshot.
- Attachment transfer uses bounded independently authenticated chunks so interruption resumes without trusting partial files. Embeddings remain device-local and are recomputed rather than synchronized.
- Every peer run requires explicit target approval in the MVP. The target chooses and enforces its own `peerEligible` security profile; a requester cannot transmit or widen roots, tools, secrets, network, duration, or concurrency.
- The current deliverable is a Mac-local protocol and relay simulation. Real Ubuntu/AWS, TLS/domain/public networking, native Windows validation, signing/update policy, production recovery, and professional protocol audit remain mandatory deferred gates, not implied successes.

## Phase 4 current-Mac hardening decisions (2026-08-03)

- Waypoint has no product telemetry or automatic crash upload in the MVP. Guided diagnostics run locally; a user may explicitly save a content-minimized report whose paths, content, prompts, credentials, keys, and raw errors are excluded.
- The MVP recovery baseline is a bounded, corruption-checked plaintext logical backup at a user-selected location. SHA-256 detects accidental corruption, not malicious replacement or authenticity. External backups have a retention lifecycle separate from live deletion and must be protected and deleted by the user.
- Restore always creates a new workspace and object identities. Authored content, supported attachments, content-minimized lifecycle history, execution provenance, and profile definitions may be restored; embeddings/full-text indexes rebuild, and device keys, credentials, transport/session state, and peer enrollment are excluded.
- Schema 5 begins an ordered migration registry from the known schema-4 baseline. A known old database receives a retained pre-migration SQLite snapshot; migrations are transactional and stamp only after success. A newer unknown schema fails closed, and Waypoint never automatically downgrades.
- Current-Mac backup replacement uses a durable temporary file, verified deterministic prior copy, one atomic rename over the destination, and directory synchronization. Windows replacement semantics remain a mandatory platform-contingent test.
- Direct packages are pinned exactly with Node `22.16.x`, npm `10.9.x`, and lockfile reproducibility. High-severity audit, complete declared-license inventory, and a production CycloneDX SBOM are release evidence.
- The version-2 performance fixture and absolute budgets are current-Mac regression controls, not claims for Windows or the oldest supported hardware. It measures startup/reopen, search, index writes, attachment ingestion, graph, diagnostics, and database growth.
- Docker remains unnecessary. Packaged clients do not require Node; source development and the future native Ubuntu service use pinned native Node/npm paths.

## First-Class Chat repair decisions (2026-08-03)

- Native CLI discovery uses a bounded list of standard install locations in addition to `PATH`; it never starts a login shell or evaluates user profiles. The resolved executable directory is added to the minimized child environment so Finder-launched packages behave like terminal launches.
- Chat attachments begin as chat-owned queue items and atomically become message-owned when sent. Message/chat deletion therefore applies the existing hard-delete cascade, while an individual attachment can be removed independently.
- CLI handoff is capability-specific. Waypoint passes supported images to Codex through its native `--image` flag and text through stdin; it passes text to Claude through stdin. This is not a claim of provider receipt or understanding. PDF/DOCX remain local sources until a separately reviewed extraction or provider path exists.
- The attachment allowlist, integrity validation, limits, private permissions, and generated storage paths are security boundaries. Original filenames are display/provenance metadata, never storage paths.
- New Chat creates a selected empty durable conversation immediately. It does not manufacture an unsent “first message.”

## Future implementation-readiness decisions (2026-08-03)

- Future work follows the ordered gates in `outputs/FUTURE_IMPLEMENTATION_READINESS.md`: authority/protocol freeze; real secure relay; Windows/release readiness; second-brain experience; proactive intake/automations; provider/agent orchestration; then mobile companion. Local fixture work may overlap, but no simulation substitutes for real platform, network, provider, or physical-device evidence.
- The Ubuntu/AWS node remains an opaque, least-privilege relay installed through a native Docker-free path. Real provisioning, DNS/TLS/firewall exposure, AWS cost, region, credentials, backups, and teardown require explicit user authorization. Employer networks require employer authorization.
- Personal and employer accounts/tenants are separate data boundaries. Connector read, durable ingest, model access, draft, and external write are distinct grants. Microsoft 365, Teams, Outlook, calendar, Azure DevOps, webhook registration, app credentials, real data, and sends/writes require provider-specific user authorization and employer approval where applicable.
- Second-brain facts, commitments, learned rules, briefings, and transcripts are provenance-bearing derived data. The safe default is reviewable suggestion rather than silent permanent memory or new authority; source revision and deletion lifecycle remain enforceable.
- Audio capture is a separate consent and retention boundary. It cannot record covertly or imply participant/legal consent, and upload/sync/transcription choices require explicit policy.
- Provider fallback and agent delegation cannot cross a provider, device, region, account, workspace, cost, or security boundary implicitly. Child authority is capped by both parent authority and the executing device's profile; recursive/budget limits and complete lineage are mandatory.
- Mobile begins as a capture/review companion. Peer-equivalent execution, audio, broad background behavior, store publication, push credentials, and distribution are later authorization gates, not assumptions.
- Apple/Windows signing identities, notarization, update hosting, public distribution, and production release channels require explicit credential custody and release authorization. Uninstall must distinguish application removal from deliberate workspace deletion.

## Chat-first UI decisions (2026-08-03)

- Primary navigation belongs in a persistent left rail. Knowledge, activity, health, and settings are compact secondary entries; knowledge opens only when invoked so it cannot compete with chat.
- Desktop transcript and composer use the whole central pane with responsive gutters. There is no fixed narrow reading column or permanent right panel.
- Conversation history defaults to date groups and recent-first order. A–Z intentionally becomes one alphabetical group, and search covers titles plus message content.
- Hard-delete and note management stay reachable but unobtrusive. Conversation-derived notes are created with their provenance relationship in one transaction.
- Right drawers and responsive navigation are modal overlays with explicit focus containment and restoration.
- Window display, normal bounds, and maximized state are private local preferences. Restore validates live displays and bounds, recenters off-screen state, and falls back safely when state is corrupt or a monitor is disconnected.
- The chosen Waypoint identity is the compass-orbit mark. The production UI uses a deterministic transparent SVG recreation rather than shipping the chroma-green concept raster; navy compass/orbit geometry and a blue waypoint node remain legible at sidebar and message-avatar sizes.

## R0 authority and protocol freeze (2026-08-03)

- Conservative local defaults are frozen in `implementation/R0_PROTOCOL_FREEZE_DECISIONS.md` and machine-readable in `electron/core/sync/protocol-contract.ts`. They authorize no external action.
- Protocol/schema support is v1 with fail-closed negotiation. Relay envelope lifetime is at most 7 days, relay backup retention at most 14 days, tombstones at least 90 days plus every active peer acknowledgement, and peers are never automatically revoked.
- Recovery is an explicit user-held, Argon2id13/XChaCha20-Poly1305-protected, versioned offline artifact with fixed KDF parameters, encoded salt/nonce, authenticated header, corruption checksum, and no server escrow. Recovery never reverses deletion; restored identities/snapshots follow anti-resurrection rules.
- Development targets are Apple Silicon macOS 14+, x64 Windows 11, and a future native Ubuntu 24.04 LTS relay on x64/arm64. Only current-Mac evidence is claimed now.
- Release identity remains private unsigned local development. Signing organization, certificates, notarization, update hosting, publication, AWS region/account/cost, DNS/TLS/firewall, and relay backup destination require later explicit authority.
## R1 local relay preparation — 2026-08-03

- Freeze the local durable relay store on SQLite schema version 1 with canonical ISO timestamps, serialized replay/quota enforcement, authenticated-recipient binding, a 256 MiB disk reserve, and opaque aggregate health. Rationale: fail closed on retention, concurrency, impersonation, schema, and disk-pressure hazards before any hosted surface exists.
- Keep the AWS artifact inert and ARM64-only (`t4g.small`) with explicit CIDR ingress, IMDSv2, encrypted retained root storage, and a localhost-only egress rule. Rationale: CloudFormation creates default allow-all egress when no rule is supplied; deployment must not silently open it.
- Condition the native service on a future reviewed public authority registry and exit with configuration status 78 before any listener starts. Rationale: no unauthenticated placeholder transport and no restart loop; hosted authority/TLS/transport remains an explicit user-authorized R1 gate.

## R1 hosted vertical slice — 2026-08-03

- Reuse the approved shared x64 Lightsail VM at zero incremental host cost; dedicate `waypoint-relay.johnnycode.ai`, loopback port 8789, a locked service identity, and isolated SQLite paths. Do not use PostgreSQL or Docker.
- Terminate TLS 1.3 at the marker-bounded Caddy site. Requests bind workspace/device/epoch and content through device signatures and durable nonces; enrollment remains offline/disabled until its canonical workflow exists.
- Retain messages for at most seven days and authenticated same-host rollback backups for at most fourteen days. Same-host backup is not represented as disaster protection.
- Leave the deployed registry empty after isolated validation. Rationale: validation private keys are ephemeral and must not become implicit production enrollment.

## R1 desktop sync integration — 2026-08-03

- Keep all workspace/device private keys in the OS-protected main-process vault; the relay and renderer receive only public identity, wrapped keys, opaque envelopes, and sanitized status.
- Retain exactly the prior workspace key after rotation only to drain already-accepted prior-epoch messages. Refuse a subsequent rotation while such relay messages remain, rather than silently dropping them or retaining an unbounded key history.
- Treat re-enrollment as an explicit owner-authorized replacement snapshot. Bind it to the requester, stage all content atomically, send the destructive manifest last, and require a durable outstanding local request before pruning.
- Use 4 MiB independently authenticated attachment chunks under the existing 25 MiB product limit. Persist missing-index requests and bounded sender metadata so an interrupted transfer resumes selectively without Docker or a new external service.
- Preserve ambiguous snapshot enqueue authorization until its 24-hour expiry because a transport failure cannot prove server rejection. This prevents an accepted response from becoming permanently unauthorized at the queue head.
- Production enrollment remains empty by default. Enabling a real workspace requires the explicit public-only first-owner bootstrap ceremony; no private key or workspace key is copied to the VM.

## Post-R1 sequencing and R3 Slice 1 — 2026-08-03

- Defer two-physical-device and Windows-native validation until planned feature implementation is finished, by explicit user direction. This does not convert missing hardware evidence into a pass and does not authorize signing, publishing, or update hosting.
- Advance from hardware/credential-bound R2 to the locally implementable R3 slices while keeping R2's release gate open. R3 derived data may be developed locally because R0/R1 provenance, lifecycle, and sync foundations are established.
- Commitments and memory extraction starts with deterministic `local-patterns-v1`, explicit markers, threshold 0.72, bounded scans, and no silent auto-save. This avoids new provider, credential, network, cost, or unattended-action authority.
- Rejection prevents exact re-suggestion for the same extractor/source span but does not create a learned profile. Accepted commitments are source-owned; accepted ordinary memories follow the existing source-linked detach semantics.

## R3 Slice 2 — local daily briefing (2026-08-03)

- Compose briefings only on explicit user request from local workspace commitments, notes, and memories. No external connector, model, schedule, notification, or send authority is implied.
- Use the renderer's operating-system IANA timezone as the request default, fail closed on invalid zones, and make the calculated local day visible. Dismissal lasts only for that local day.
- Cap output at 50 items, prioritize up to 30 open commitments, and disclose overflow, stale state, disconnected sources, and unsupported recurrence rather than implying completeness.
- Store dismissal metadata without copied content and cascade it with the source object. A later day automatically makes the item eligible again.

## R3 Slice 3 — knowledge graph and learned rules (2026-08-03)

- Learned rules remain advisory, local, and workspace-scoped. Approval cannot alter prompts, providers, tools, security profiles, schedules, sync, or external state in this slice.
- Require two distinct user-message directives, exact source provenance, and a current dry run before approval. Do not learn from assistant/system text or rejection behavior.
- Treat suggestions and approved rules as source-owned. If valid provenance falls below two messages, delete the inferred rule rather than retaining a hidden profile.
- Version rules from `local-directives` extractor `1.0.0`; outcome history records only action, counts, version, and timestamps, never copied source text.

## R3 Slice 4 — unified activity timeline (2026-08-03)

- Project activities through a content-minimized display contract instead of exposing stored metadata JSON to the renderer. Only an explicit primitive-value allowlist is visible; authored content, paths, credentials, keys, raw output, and payloads remain excluded.
- Normalize existing producers into stable content, execution, sync, rules, lifecycle, and maintenance families. Reserve meeting and automation families without fabricating events or implying those features are active.
- Preserve deletion events as non-navigable historical evidence while resolving only currently surviving object labels. This keeps deletion auditable without retaining deleted titles or bodies.
- Bound each timeline query to 500 inspected records and 500 maximum returned records, with a default of 250, and add a workspace/time index in schema 12.

## R3 Slice 5 — local audio-only meetings (2026-08-03)

- Require per-session participant-consent acknowledgment, an explicit Start action, OS microphone permission, a persistent red recording state, and explicit Stop. Waypoint explains that the user remains responsible for legal/participant consent.
- Keep meeting audio, transcripts, and derived memory local-only and unsynced. Retain until explicit delete, display size/status, cap capture at two hours and 100 MiB, and preserve a 256-MiB disk reserve.
- Do not invoke the installed Whisper executable: its capability probe stalled and no reviewed cached/packaged model exists. Do not download a model implicitly. Expose a truthful unavailable capability and bounded manual transcript draft until model packaging/licensing/performance pass a separate gate.
- Treat all speaker labels as uncertain. Require explicit transcript review before creating a source-owned memory; meeting deletion removes that memory, its search entry/relationship, transcript, and audio.
- Include bounded integrity-checked meeting artifacts in explicit backup/restore and user-selected audio export, while keeping sync and external delivery disabled.

## R4 Slice 1 — fixture connectors and paused playbooks (2026-08-03)

- Prove the connector and playbook contracts with bundled synthetic data only. The fixture identity has a declared local account and tenant, read scope only, no token reference, and no network, draft, or write capability.
- Create every playbook paused and expose schedule times only as timezone/DST-aware previews. Background activation is intentionally unavailable until separately authorized.
- Require a current definition-bound dry run before manual fixture execution. Preserve exact permission snapshots, deterministic idempotency, three-attempt dead-lettering, and an immediate kill switch.
- Keep playbooks and runs device-local and workspace-scoped. Backup restore recomputes definition provenance and clears dry-run and idempotency authority so restored workflows cannot run without fresh review.
- Treat fixture bodies as untrusted content: they cannot influence capability declarations and are excluded from activity details and sync mutations.

## R5 Slice 1 — local explainable provider routing (2026-08-03)

- Record Outlook/calendar and later R4 connectors as authorization-blocked; do not simulate a real connector or treat fixtures as provider validation. Advance to the next locally safe roadmap foundation without claiming R4 connector completion.
- Limit the registry to the already-authorized signed-in Codex and Claude Code CLIs, local device, subscription cost class, and existing conservative security profiles.
- Default fallback off. A proposal may describe opt-in fallback only between currently healthy local signed-in CLIs without changing workspace, device, profile, privacy, cost, or network boundary.
- Recompute eligibility in the trusted main process immediately before execution creation. Renderer selection is a preference, never authority.
- Unsupported attachments remain local with truthful per-provider eligibility; they do not silently cross providers or become model input.

## R5 Slice 2 — bounded local child tasks (2026-08-03)

- Delegation is explicit and limited to one typed child (`analyze`, `summarize`, `critique`) from one completed root result. Recursive and duplicate delegation remain forbidden.
- Permit Claude children only because its reviewed adapter disables tools. Codex child tasks fail truthfully until a reviewed no-tool invocation is available; read-only filesystem sandboxing alone is not represented as no tools.
- Child context is a maximum 100,000-character parent result labeled untrusted plus a maximum 4,000-character user instruction. It does not inherit attachments, hidden chat history, secrets, connectors, or new roots.
- Cap child runtime at 60 seconds or the lower profile cap. Provider, workspace, chat, local device, profile, concurrency, and fallback policy cannot change.
- Parent cancellation terminalizes queued children before spawn and cancels running children. Startup rechecks durable queued state after CLI detection.

## R5 Slice 3 — local embedding and chunking benchmark (2026-08-03)

- Use the versioned representative Waypoint suite and isolated in-memory indexes; never infer a product default from incomparable public aggregate claims or mutate live workspace search during evaluation.
- Recommend Qwen3-Embedding 4B under the production-ready whole-document policy from current local evidence. Keep Qwen 8B unavailable until installed/hardware-tested and retain BGE-M3 as the lighter baseline.
- Read active Ollama model memory from its loopback `/api/ps` endpoint and keep harness RSS separate. Never substitute file size for runtime memory. Recommendation requires measured runtime memory below 80% of host RAM plus the model's registered minimum-memory gate.
- Keep direct llama.cpp and Chonkie disabled pending native packaging and dependency/license review. OpenAI comparison remains disabled pending explicit API key, data, and cost authorization.
- Trusted-peer selection is a typed policy seam only: local remains the default; peer eligibility requires model capability, memory, availability, workspace permission, explicit allow policy, and user preference.
- Encode chunk policy identity/version/digest with every new live vector generation. Any provider, model, digest, dimensions, or chunk-policy change requires explicit reindex rather than silent vector mixing.
- Retain at most the two newest provenance-distinct vector generations per object so a failed/default change can roll back without rebuilding immediately. Source revision change and deletion still purge every generation, preserving lifecycle semantics.

## R5 Slice 4 — conservative local execution budgets (2026-08-03)

- Derive every budget in trusted main-process code from the effective workspace security profile and actual root/child request. Renderer data never grants or widens budget authority.
- Treat Send/Retry and Delegate as explicit per-run user actions. Each action receives a new one-attempt receipt; automatic retry and unattended continuation remain unavailable.
- Root default: 2,000,000 prompt bytes, 8 MiB output, at most 120 seconds/profile cap, one concurrent run, depth one, one child, and up to 20 selected attachments. Child default: 512 KiB prompt, 2 MiB output, at most 60 seconds/profile cap, no child or attachment.
- Fix all current receipts to local device, fallback off, external cost off, peer off, one attempt, and the digest of the effective profile. Wider values require a later explicit user policy decision and review.
- Persist content-minimized receipts with the execution rather than duplicating prompt/output or sensitive profile contents. Receipt restore and deletion follow execution ownership.

## Post-MVP health — local backup administration (2026-08-03)

- Keep backup verification genuinely read-only: it parses the selected file directly and never invokes adjacent-file crash recovery.
- Use the production restore path only inside a fresh temporary database/artifact root. Never replace, merge into, or otherwise mutate the active workspace during a drill.
- Return only basename, version/time, aggregate counts, stable failure code, and remediation to the renderer. Absolute paths, workspace identity, content, keys, prompts, and raw exceptions remain in the trusted process.
- Keep plaintext export an explicit user choice. Encryption, scheduling, retention, destination persistence, remote storage, and restore-over-live require separate product/security authority.
- Record remaining R5 wider authority and R6 mobile/platform choices as gates, then advance to this safe local health slice without claiming them complete.

## Post-MVP health — responsive backup administration (2026-08-03)

- Run backup verification and restore drills in one dedicated worker at a time so a large explicit local archive cannot freeze the chat UI or compete through unbounded worker creation.
- Treat worker messages as untrusted structured input. Expose only the existing sanitized result contract; worker faults never expose raw errors or absolute paths.
- Give the parent runner ownership of a per-drill outer temporary root. A five-minute deadline may then terminate a hung worker, await termination, remove the entire outer root independently, and release the single-operation slot without trusting worker cleanup.
- Keep webhook/calendar, encryption/retention, mobile, peer, Windows, signing, distribution, and physical-device work behind their recorded authority gates.

## Production local document ingestion (2026-08-03)

- Use pinned PDF.js and Mammoth JavaScript libraries for local PDF/DOCX text extraction; TXT/Markdown use strict UTF-8. Do not add Python, Docker, cloud parsing, OCR, macros, or implicit downloads.
- Preserve the source as a document-owned attachment and extracted text as its canonical revision. Chunks/vectors are owned derived state with exact source offsets and are intentionally rebuilt rather than exported.
- Use the built-in deterministic sentence-window policy for production document chunks. Keep Chonkie disabled pending its separate packaging/audit gate.
- Treat Ollama/Qwen3-Embedding 4B as optional local semantic capability. Lexical import remains useful and truthful when unavailable; no fixture vector substitutes for production embeddings.
- Sequence next: local trigger rules/webhook simulation only, then first-class local voice chat. Public ingress, schedules, external connectors/data/actions, cloud voice, implicit model downloads, and unattended activation remain unauthorized.

## Roadmap completion addendum (2026-08-03)

- Adopt `outputs/ROADMAP_COMPLETION_ADDENDUM.md` as the canonical remaining slice order after local document ingestion. Safe local work proceeds through triggers, live voice, meeting-transcription evaluation, opt-in whole-device capture, peer-control simulation, richer orchestration, and calendar/meeting fixtures before two-instance validation.
- Treat Recall-style capture as default-off and per-workspace, with immediate global pause, pre-persistence app exclusions, bounded rolling retention, explicit encrypted-sync choice, and hard deletion of every owned derivative/replica. Employer-managed-device use remains separately authorized.
- Keep proactive automation progression explicit: observed event → suggested rule → approved/dry-run rule → separately activated autonomous policy. The next slice is simulation/configuration only, with visible state, pause, kill, retry/dead-letter, and no endpoint/schedule/action.
- Model cross-device command/agent control with preferred device, eligibility explanations, target-issued finite leases, deterministic no-failover default, target-local profile enforcement, and explicit cancellation/revocation. Real peer activation waits for sync/device evidence and user policy.
- Use whisper.cpp plus swappable TTS (native OS/Kokoro benchmark) as the production voice baseline; the turn manager owns VAD, echo guidance, barge-in, generation/playback cancel/pause, and honest bounded filler. Moshi stays experimental full-duplex; CrisperWhisper stays optional post-meeting transcription only. No implicit model install/download.
- Build unified calendar/meeting-copilot contracts against local fixtures before any Microsoft authorization. Multi-provider handoff, parallel adversarial review, and typed agent orchestration remain bounded and explainable; new providers/costs/devices/unattended authority require approval.
- Activate Outlook, Teams, email, DevOps, calendar, and signed public webhooks one provider/capability at a time after app/tenant/account/scope/data/retention/model/sync/write authority. Mobile remains a post-sync companion with separate platform/store/push/device decisions.
- Run two isolated instances and then two physical Macs after all eligible safe local slices, before claiming cross-device readiness. Windows and release/signing/update evidence remain hardware/identity gated.

## P1 local proactive trigger lab (2026-08-03)

- Persist only synthetic local fixture envelopes and simulation-only rules. Every rule begins suggested, requires explicit approval into a paused state, and can only produce a deterministic zero-effect preview.
- Recompute exact event, rule, and run provenance before display or use; reject authority-shaped payload keys, non-record JSON, replay/staleness, tampering, and cross-workspace access rather than repairing data silently.
- Keep retry/dead-letter history finite and truthful, make terminal dead letters idempotent, and let the workspace kill switch dominate evaluation.
- Public ingress, schedules, real senders/accounts/data, models, outbound effects, and unattended stages remain separate activation decisions.

## Memory consolidation / reflection pattern (2026-08-03)

- Borrow the review-oriented pattern from Anthropic Managed Agents “Dreaming,” but do not integrate or imply use of Anthropic's preview, API-based managed feature. Waypoint remains signed-in-CLI-only and subscription-first for this slice.
- Place local Memory Consolidation / Reflection at P8, after the earlier safe-local product slices and before V1 sync validation. It is explicit-run, workspace-scoped, source-bounded, budgeted, auditable, and killable.
- Preserve canonical sources unchanged. CLI output becomes a separate proposed revision with exact provenance and diff/accept/edit/reject review; stale, duplicate, and contradictory claims remain explicit rather than silently merged.
- Accepted changes retain rollback lineage and source-deletion cascade. Cross-workspace/client inputs fail closed, and backup/restore/deletion/sync must cover both proposals and accepted derivatives.
- Scheduling and any low-risk auto-apply remain later, separately authorized policy stages with their own safety gate.
