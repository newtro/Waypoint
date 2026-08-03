# R0 conservative protocol decisions

These defaults are intentionally restrictive and reversible through the decision-log change process.

## Protocol, support, and retention

- Protocol version is `1`. Objects support schema `1`; attachments negotiate `1..2`. Unknown required schemas fail closed.
- Relay workspace, device, request, and message identifiers are client-generated random UUIDv4 values represented without user labels/content. The relay also enforces a bounded URL-safe transport shape; shape validation is defense in depth and is not itself proof of randomness.
- Relay envelopes may live at most 7 days. Relay backups may be retained at most 14 days; app-managed temporary diagnostics at most 7 days. User-saved diagnostic exports have no automatic lifecycle and remain the user's deletion responsibility. Acknowledged relay messages are removed from the live queue immediately.
- Tombstones remain at least 90 days and until every active peer acknowledges. Waypoint never automatically revokes an inactive peer; the user must revoke it before tombstone purge and it must re-enroll from a fresh snapshot.
- Development support is Apple Silicon macOS 14+ and x64 Windows 11 with at least 8 GiB RAM and 2 GiB free for the base app/data (optional local models require separately reported space). A future native Ubuntu 24.04 LTS relay targets x64/arm64 with at least 2 GiB RAM and 20 GiB free. Windows and Ubuntu claims require their native gates.
- Release identity remains unsigned, private local development only. Production signing organization, channels, publication, and update hosting remain unselected and cannot be inferred.

## Recovery and key lifecycle

- Recovery uses a versioned offline `waypoint-recovery` artifact: Argon2id13 (`opslimit=2`, `memlimit=67,108,864` bytes) derives a 32-byte key; XChaCha20-Poly1305-IETF wraps the workspace key with a 24-byte nonce and authenticated `[format, version, workspaceId, createdAt]` header. Salt, nonce, and ciphertext use standard padded base64; SHA-256 covers the canonical manifest fields for corruption detection. AEAD authenticates the wrapped key. There is no relay/server escrow key.
- Recovery never reverses tombstones. Restored content receives new identities or a reviewed fresh snapshot. Artifact loss may make encrypted data unrecoverable; artifact theft plus its passphrase may grant recovery.
- Revocation advances membership/key authority and blocks future delivery. Key rotation/re-wrapping must be resumable and cannot silently drop an authorized offline peer; production orchestration remains R1.

## Data/secret map

| Data | Plaintext location | Relay/backup visibility | Retention owner | Delete/recovery rule |
|---|---|---|---|---|
| Workspace bodies, prompts, filenames, object IDs | Owning client SQLite/object store | Encrypted only; never relay logs | Workspace | Cascade delete; tombstone dominates; restore uses new identity |
| Workspace key | Trusted client memory / future protected OS store | Wrapped per device only | User/device enrollment | Rotate after revocation; never exported plaintext |
| Device private keys | Future Keychain/DPAPI; never renderer | Never relay, sync, diagnostics, or logical backup | Device | Destroy locally on unenroll; recovery artifact is separate |
| CLI OAuth/session | CLI-owned OS state | Never Waypoint DB, relay, backup, prompt, or logs | CLI/provider | Waypoint cannot recover or sync it |
| Relay delivery metadata | Relay database/logs | Protocol version, opaque workspace/device IDs, epoch, sequence, size, timing | Relay operator | Queue ack/expiry; backup maximum 14 days |
| Enrollment/invitations | Relay enrollment store | Protocol, opaque workspace/request/device IDs, applicant public keys, owner device, membership epoch, created/expiry/consume times | Relay operator | One-use and expiry; revocation is terminal for the identity |
| Presence | Relay ephemeral store | Opaque workspace/device IDs and observed/expiry times | Relay operator | Expires automatically; revocation removes presence |
| Acknowledgements/cursors | Relay delivery store | Opaque workspace/recipient/message IDs and acknowledgement time | Relay operator | Bound to delivered identity; queue item removed on valid ack |
| Relay backup | Operator-protected encrypted storage | Backup version/timing, encrypted database bytes, integrity digest | Relay operator | Maximum 14 days; restore cannot decrypt workspace payloads |
| Recovery artifact | User-selected offline location | Never server escrow | User | Separate explicit retention/deletion; no silent copy |
| Recovery passphrase | User input / trusted client memory only | Never node, database, logs, sync, backup, or diagnostics | User | Never persisted by Waypoint |
| Activity/diagnostic data | Local content-minimized store/export | No automatic upload | Workspace/user | Source lifecycle; export deleted separately by user |

The earlier Phase 3 provisional list is superseded for protocol v1 where it mentioned an envelope type and delivery cursor: v1 has neither field. If a later protocol introduces either, it requires a versioned metadata review. Enrollment request/approval signatures, applicant public keys, and wrapped-workspace-key ciphertext are node-visible; private keys and plaintext workspace keys are not.

## Authority defaults

- Personal workspaces accept only user-owned local data unless a later connector grant says otherwise. Employer-managed data is denied by default.
- External content, provider output, webhook payloads, transcripts, and agent results are untrusted data and cannot grant authority.
- Model fallback, peer execution, background schedules, audio recording, notifications containing content, and connector writes are disabled until explicitly scoped and approved.
