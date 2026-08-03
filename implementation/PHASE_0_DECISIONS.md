# Phase 0 architecture decisions

These decisions bound implementation of the approved MVP. They may be revised through the decision-log change process, but are sufficiently concrete for Phase 1.

## Native platform baseline

- Develop, build, test, package, and run natively. Docker is not required.
- Initial validation targets Apple Silicon macOS 14+ and x64 Windows 11. By user decision, Windows-only build/package/launch/update/filesystem/process checks become mandatory when the project moves to a native Windows platform and do not block Mac work. Windows arm64 remains a compatibility target after the native-module test matrix is proven.
- Electron renderer processes use sandboxing, context isolation, and no Node integration. Privileged behavior lives behind narrow, validated main-process IPC contracts.
- Unsigned local directory packaging is sufficient for development; release signing, notarization, update channels, and rollback are Phase 4 work.

## Local storage

- Use SQLite as the canonical local store, owned by the Electron main process.
- Store authored Markdown/plain-text document bodies, durable chats, curated/proposed memories, graph edges, activity events, sync state, and deletion state transactionally.
- Keep attachments in a workspace-scoped content store with database metadata; hashing provides integrity and deduplication only within a workspace.
- Keep full-text and vector indexes derived and rebuildable. Every index entry carries source object ID and source revision.
- Do not expose database handles or arbitrary SQL to the renderer.

## Object ownership and deletion

- Workspace is the lifecycle/security root.
- Messages are owned by chats. Revisions, embeddings, extracted text, and object-scoped attachments are owned by their source revision/object.
- Memories can be workspace-owned or explicitly source-owned; their ownership is immutable after creation unless copied into a new identity.
- Graph edges are workspace-owned references and are deleted whenever either endpoint is deleted.
- Executions are owned by their requesting chat/task; cancellation and content-minimized activity evidence survive only under the workspace retention policy.
- Deletion is transactional locally: write a tombstone, remove owned descendants and derived data, cancel dependent queued work, and enqueue sync propagation in one durable operation.
- Tombstones are retained for at least 90 days and until every currently enrolled peer acknowledges them. A peer offline beyond the retention window must be revoked before purge and must re-enroll from a fresh snapshot, preventing resurrection.
- A restore creates a new object identity; it never reverses a distributed tombstone.

## Coordinator trust and encryption

- The coordination node is an untrusted durable relay with respect to workspace content.
- Workspace payloads and attachments are end-to-end encrypted on clients before upload. The node may see only protocol version, opaque workspace/device identifiers, encrypted payload sizes, ordering/delivery metadata, and timestamps needed for service operation.
- Each device has its own identity key. Workspace data keys are generated client-side and wrapped per enrolled device.
- Revocation prevents new key material and future sync delivery to that device; it cannot erase data already present on a lost device.
- Key recovery requires an explicit user-held recovery artifact. There is no silent server-side recovery key.
- Model-provider/CLI credentials and inherited process secrets never sync.
- Exact cryptographic primitives and audited library selection remain a pre-Phase 3 implementation decision; custom cryptography is prohibited.

## Sync convergence

- Changes carry immutable IDs, origin device, monotonically increasing per-device sequence, causal metadata, schema version, and encrypted payload.
- Ordered append-only messages use stable identities; concurrent document bodies preserve both variants and request user reconciliation.
- Metadata fields may use deterministic last-writer selection with a hybrid logical clock and device-ID tie-break only where silent merge cannot lose authored content.
- Tombstones dominate all updates to the same identity regardless of arrival order.
- The node stores encrypted change envelopes until acknowledged and eligible for retention purge; peers retain an outbox until receipt is durable.
- The executable Phase 0 model intentionally proves only deterministic ordering and tombstone dominance, not the full protocol.

## Local embeddings

- Phase 1 uses a swappable provider interface; Ollama with Qwen3-Embedding 4B is the current quality-first optional local default based on suite v2, while BGE-M3 is the lighter fallback. No text is sent to hosted embedding services.
- Vectors are device-local and recomputed rather than synchronized.
- Model ID, model version, dimensions, chunking version, source object, and source revision are stored with every vector.
- The Phase 0 hash-vector benchmark validates local indexing throughput mechanics only and is not accepted as a semantic model.
- A dependency-safe model candidate plus representative corpus, binary size, license, and current-Mac measurements are required to close Phase 0. Windows/oldest-hardware checks are mandatory when those environments are available.
- Provider/model/digest/dimensions/suite provenance makes reindexing explicit and reversible.
- Chunking provider/version/policy/configuration/suite provenance is also explicit; policy changes create a new reversible index generation.
- Trusted peer workers are a future policy-driven execution location; remote serving is not implemented in Phase 0.

## CLI and security boundary

- Detection invokes only `--version`. Phase 0 may run explicitly authorized, tool-free, non-persistent live requests to validate sign-in, streaming, cancellation, and failure behavior; ordinary product requests remain Phase 2 work.
- Adapters execute a resolved allow-listed binary without shell interpolation, pass a minimized environment, constrain the working directory to granted roots, cap time/output/concurrency, and preserve structured provenance.
- CLI output is untrusted and cannot itself authorize tools, broader roots, peer execution, or network access.
- A remote request is re-authorized and enforced by the target device's local security profile.
- Phase 2 must validate the supported CLI version ranges from observed behavior; Phase 0 records the available local versions without claiming compatibility.

## Phase dependencies

- Phase 1 may build the local workspace against these ownership and storage rules.
- Phase 2 may build execution adapters against the local privilege boundary.
- Phase 3 remains blocked on choosing audited cryptographic libraries and completing the two-peer coordinator environment. Windows-native verification is platform-contingent and must run as soon as the project moves to Windows.
