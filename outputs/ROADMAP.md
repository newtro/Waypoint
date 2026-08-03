# Waypoint delivery roadmap

The roadmap is ordered to retire product and trust risks early. Dates are intentionally omitted until prototypes establish effort and team capacity.

## Phase 0 — validation and technical spikes

**Goal:** turn open architectural risks into bounded decisions.

- Validate Electron packaging, updates, filesystem behavior, and process supervision on supported macOS and Windows versions.
- Validate native build, test, setup, and runtime paths without Docker.
- Prototype versioned Codex and Claude Code CLI adapters, including sign-in detection, streaming, cancel, and failure behavior.
- Test local embedding runtimes on representative hardware and corpus sizes.
- Model sync conflicts and deletion convergence with a Mac peer, Windows peer, and intermittently available Ubuntu node.
- Produce an initial threat model and choose the content-encryption posture.
- Define the canonical object ownership and cascade rules.

**Gate:** no unresolved feasibility issue threatens the core loop; security and sync choices are documented well enough to build against.

## Phase 1 — local product alpha

**Goal:** a trustworthy, useful single-device second brain.

- Guided onboarding and personal workspace creation.
- Durable documents, chats, memories, relationships, and supported attachments.
- Local text and semantic search.
- Memory graph navigation.
- First-pass activity timeline.
- Local export, restore proof, and cascade deletion tests.

**Gate:** the application survives restart/crash testing, search is traceable, and deleted content leaves no owned local derived artifacts.

## Phase 2 — AI workbench alpha

**Goal:** visible, constrained work through signed-in CLIs.

- Codex and Claude Code CLI adapters.
- Visible routing and execution status.
- Security profiles with conservative defaults.
- Durable streaming into chats.
- Bounded coordinator/child-agent execution with visible lineage.
- Cancellation, timeout, retries, and actionable compatibility errors.

**Gate:** privilege boundaries are enforced locally, execution provenance is complete enough to understand each run, and either CLI can fail without harming workspace integrity.

## Phase 3 — multi-peer private beta

**Goal:** reliable Mac/Windows continuity through the user's node.

- Ubuntu/AWS node setup and health surface.
- Device enrollment, identity, revocation, and presence.
- Offline sync, conflict UI, resumable attachment transfer, and schema negotiation.
- Distributed cascade deletion and anti-resurrection behavior.
- Authorized peer-device execution.
- Cross-platform update and compatibility policy.

**Gate:** the sync test matrix converges, revoked devices lose access, stale peers cannot resurrect deletes, and peer execution cannot exceed the target device's security profile.

## Phase 4 — MVP hardening and release

**Goal:** make the core loop supportable and recoverable.

- Guided diagnostics for CLI, sync, indexing, and disk issues.
- Accessibility, performance, telemetry/privacy choices, and onboarding refinement.
- Backup/restore baseline and documented disaster recovery.
- Security review, dependency review, and destructive-action testing.
- Migration and rollback strategy.
- User documentation for node operation and data boundaries.

**Gate:** all MVP acceptance criteria pass on the supported OS/version matrix; recovery and deletion are demonstrated, not assumed.

## Post-MVP sequence

The implementation-ready completion order is now canonical in `outputs/ROADMAP_COMPLETION_ADDENDUM.md`. It places local triggers/webhook simulation first, then local voice, CrisperWhisper evaluation, opt-in whole-device capture, local peer-control policy/simulation, richer orchestration, and local calendar/meeting fixtures. Two-instance sync validation follows all eligible safe local slices and precedes cross-device release claims. External connector/public-ingress activation and mobile distribution retain their separate authority gates.

Order should follow validated demand and privacy risk, but the likely dependency-aware progression is:

1. Schedules and playbooks, using the established execution/security model.
2. Health and richer backup administration, strengthening unattended reliability.
3. Proactive webhooks, after schedule permissions and signed ingress are mature.
4. Unified calendar, using explicit account scopes and write approvals.
5. Audio-only meeting recorder, after retention, consent, and large-artifact handling are mature.
6. Mobile companion for capture, review, and notifications.
7. Stronger sandboxing and broader integration ecosystem as operating-system support allows.

Docker is not a product prerequisite. If evaluated later as a sandbox backend, it must remain optional and cannot replace native macOS/Windows operation.

## Cross-cutting test matrix

- macOS ↔ Windows, each as first and second enrolled device.
- online, offline, interrupted, and high-latency node conditions.
- simultaneous edits, attachment replacement, graph mutation, and deletion.
- old/new client and server protocol combinations within the support window.
- Codex available/expired/missing and Claude Code available/expired/missing.
- local and peer execution under each security profile class.
- low disk, index rebuild, corrupt transfer, revoked peer, and restored backup.

## Scope-control rule

A deferred feature may enter the MVP only when it is necessary to complete or secure the core promise. “The architecture may need it later” justifies a clean boundary or recorded decision, not full implementation.

## Post-roadmap repair — First-Class Chat

- Status: current-Mac implementation and verification complete; independent review evidence is in `implementation/FIRST_CLASS_CHAT_EVIDENCE.md`.
- Scope and gate: `implementation/FIRST_CLASS_CHAT_PLAN.md`.
- Windows-native verification, signing, and published-release checks remain open and platform/authorization contingent.
