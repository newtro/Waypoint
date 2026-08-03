# Waypoint MVP plan

## Product promise

Waypoint gives one person a durable, searchable home for documents, conversations, and connected memory across their Mac and Windows computers. It lets them work with signed-in Codex and Claude Code, understand which model and device performed work, and retain control over where their data lives.

The MVP proves one complete loop:

> Capture knowledge → find or connect it → work on it with an AI assistant → inspect what happened → sync it to another owned device → delete it completely when desired.

## Target user

A technical or tool-comfortable individual who:

- works across Mac and Windows;
- wants a personal knowledge and AI workspace rather than a team collaboration suite;
- is willing to run or provision a user-hosted Ubuntu/AWS coordination node;
- already uses signed-in Codex and/or Claude Code CLIs;
- values inspectability, durable context, and control of data boundaries.

## MVP outcomes

The MVP is successful when a user can:

1. Complete native guided onboarding on macOS or Windows.
2. Create a personal workspace and understand its storage and sync boundaries.
3. Capture and edit documents and maintain durable chats.
4. Search locally using text and local embeddings.
5. See useful links among chats, documents, and memories in a memory graph.
6. Invoke Codex or Claude Code through an installed, signed-in CLI.
7. See model routing, tool/agent activity, execution device, and results in an activity timeline.
8. Sync supported workspace data through their Ubuntu/AWS node to a second peer desktop.
9. Resolve or recover safely from ordinary sync conflicts and offline work.
10. Delete a root object and verify all owned derived data is cascade-deleted locally and across peers.

## MVP scope

### 1. Desktop shell and onboarding

- Electron + TypeScript + React application for macOS and Windows.
- Native-feeling guided onboarding.
- Workspace creation with clear local paths and sync status.
- Detection and validation of Codex and Claude Code CLI installations and sign-in state.
- Connection setup for the user-hosted Ubuntu/AWS sync node.

### 2. Durable knowledge core

- Personal-first workspaces.
- Documents with autosave, revision metadata, and attachments defined by an explicit support list.
- Durable chat threads whose messages can reference documents and memories.
- Memory records and typed relationships forming a navigable memory graph.
- Local full-text search and local embedding generation/indexing.
- Provenance for AI-created or AI-modified content.

### 3. AI execution and routing

- CLI adapters for signed-in Codex and Claude Code.
- Explicit per-run model/agent routing visible before and after execution.
- A bounded orchestration model: one coordinator may delegate discrete tasks, with every delegation visible.
- Peer-device execution for an online, authorized desktop, with device identity and status shown.
- Security profiles that constrain filesystem roots, network access, tools, and peer execution.
- Cancel, timeout, and failure states that preserve the durable conversation record.

### 4. Trust, activity, and lifecycle

- Append-oriented activity timeline for meaningful user, model, agent, sync, and deletion events.
- Clear execution consent and status surfaces.
- True cascade deletion for owned descendants and derived artifacts, including embeddings, graph edges, cached attachments, sync replicas, and queued jobs.
- Tombstones or equivalent sync-safe deletion markers retained only for a documented period, followed by physical purge.
- Export and basic restore sufficient to prevent lock-in during MVP evaluation.

### 5. Cross-device sync

- User-hosted Ubuntu/AWS coordination service.
- Encrypted transport and authenticated device enrollment.
- Offline-capable desktop writes with deterministic conflict behavior.
- Sync for the MVP object set: workspace metadata, documents, chats, memories, graph edges, supported attachments, activity metadata, and deletion state.
- Operational status: last sync, pending changes, peer availability, errors, and storage usage.

## Explicitly deferred beyond MVP

These are planned capabilities, not hidden MVP requirements:

- mobile companion;
- audio-only meeting recording and transcription workflow;
- proactive webhooks;
- unified calendar;
- user-authored schedules and reusable playbooks;
- richer sandboxing and policy templates;
- automated health diagnostics and repair;
- comprehensive backup administration and disaster recovery;
- broad team collaboration, organization administration, or shared workspace permissions;
- a large plugin or third-party integration ecosystem.

Small architectural seams may be reserved for these features, but the MVP should not build their full infrastructure prematurely.

## Non-goals

- Replacing the Codex or Claude Code authentication and billing relationship.
- Routing normal inference through Waypoint-owned LLM API keys.
- Cloud-only operation.
- Treating the coordination server as a universal, opaque SaaS data owner.
- Supporting mobile as a peer-equivalent client in the first release.
- Autonomous background action without visible policy, provenance, and revocation.

## Release slices and acceptance criteria

### Slice A — trustworthy local workspace

- Onboarding creates a workspace and explains its data location.
- Documents and chats survive restart and unexpected application termination.
- Local text and semantic search return traceable source results.
- Graph relationships never outlive a deleted endpoint unless explicitly reattached by policy.

### Slice B — inspected AI work

- At least one supported version each of Codex and Claude Code can be detected and invoked.
- The user can select or approve routing and see the chosen CLI, device, security profile, and task lineage.
- Output streams into a durable chat; interruption leaves a coherent record.
- Unsupported CLI versions or auth failures produce actionable, non-destructive errors.

### Slice C — two-peer sync

- One Mac and one Windows client can enroll through a user-hosted node.
- Both can make offline edits and later converge under documented conflict rules.
- Sync interruption never corrupts the authoritative local store.
- Lost or revoked devices cannot continue syncing.

### Slice D — deletion and recovery confidence

- Deleting a document/chat/memory removes owned content, embeddings, graph edges, cached files, and queued AI work.
- Deletion propagates to all enrolled peers and does not resurrect after an offline peer reconnects.
- The activity timeline records the deletion without retaining the deleted content.
- Export and restore are tested against a representative workspace.

## MVP success measures

- A new user reaches their first captured and searchable item without external documentation.
- A user can explain where their content is stored and which device executed an AI task.
- Cross-device convergence succeeds in the defined test matrix, including offline edits and deletion.
- No known path resurrects deleted content or leaves derived semantic data behind.
- The core workflow remains useful with one CLI unavailable and with the sync node temporarily offline.

## Product principles

- **Local usefulness first:** loss of network or coordinator availability degrades sync, not basic work.
- **Visible agency:** routing, delegation, remote execution, and background behavior are inspectable.
- **Least privilege by profile:** users grant capabilities deliberately and can revoke them.
- **One durable object model:** UI features, search, graph, sync, and deletion share lifecycle semantics.
- **Progressive complexity:** the default path is simple; advanced routing and security remain available without dominating onboarding.
