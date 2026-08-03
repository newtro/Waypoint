# Production signed inbound webhook — vertical slice

Status: acceptance frozen, 2026-08-03. Executor: primary task. Reviewer: fresh independent security/privacy context after focused verification.

## Scope and authority

Add one narrow production path at the existing pinned relay origin: an enrolled workspace owner creates a webhook channel for the current device, receives a one-time signing secret plus recipient public key, and can rotate/revoke/kill it. A sender submits a signed, timestamped, nonce-bound opaque sealed event to `/v1/hooks/<channelId>`. The relay cannot decrypt it. The enrolled recipient pulls it through authenticated desktop transport, decrypts locally, and persists it as quarantined, untrusted, review-required inbound content.

No generic command, rule activation, agent/model call, external connector, account access, schedule, outbound effect, public listener beyond the existing Caddy route, DNS/firewall change, API-model dependency, or implicit download is in scope.

## Acceptance gate

1. Owner-only create/rotate/revoke/list/kill endpoints are request-signed and workspace/device bound. Secrets are returned once, encrypted at rest by a dedicated protected server key, never logged/listed/exported in plaintext, and stored locally only through OS-protected storage.
2. Public intake requires the exact channel path and MIME, HMAC-SHA-256 over a canonical version/path/timestamp/nonce/body digest, a ±60-second timestamp window, persistent one-use nonce, active channel, and constant-time comparison. Tamper, replay, expiry, malformed base64/JSON, unsupported schema/MIME, oversize, rate/concurrency/queue limits, revoked/rotated/kill states fail closed with content-free errors.
3. The relay stores only channel/event identifiers, recipient binding, timestamps/expiry, bounded opaque ciphertext, and content-free status. It cannot decrypt event type or payload and logs no body, secret, signature, full identifier, or raw exception. Retention is finite; ack/delete and expiry purge durable queue state.
4. Authenticated recipient pull/ack is exact workspace/device/channel bound. Desktop validates/decrypts the sealed box, validates a plain-record bounded inner schema, and durably stores exact channel/event/digest provenance as quarantined untrusted data. Nothing creates or runs a rule or agent.
5. UI provides channel create/configuration-copy, list/status, rotate/revoke/kill, explicit fetch, quarantined event review/delete, truthful outage/decrypt/failure states, source traceability, and zero-effect language. Secrets are never re-shown after the one-time response.
6. Workspace deletion cascades local inbound data; channel revoke/delete and relay ack/retention are explicit. Local backup/restore, diagnostics, activity audit, sync-schema compatibility, conflict/idempotency, and hard deletion are covered without leaking secrets or payloads into content-minimized logs.
7. Tests cover signing, replay, expiry, tamper, malformed/oversize/MIME, rate/concurrency/retention, outage/retry, recipient/workspace mismatch, rotate/revoke/kill, duplicate event, deletion/backup/restore, and zero-effect behavior. Full tests, lint/build/audit/SBOM, package/runtime/native launch, live TLS integration, restart/recovery, backup/rollback, and independent review finish with no unresolved blocker/high.

## Live change boundary and rollback

Reuse `waypoint-relay.johnnycode.ai` and loopback `127.0.0.1:8789`; Caddy already forwards the required path, so no Caddy/DNS/firewall/PostgreSQL change is planned. Deploy only a versioned Waypoint relay release plus its dedicated protected webhook key/config and SQLite schema. Take and verify the existing encrypted relay backup before switching `current`. Restart only `waypoint-relay.service`. Roll back by switching `current` to the prior release and restoring the pre-change relay backup if schema compatibility requires it.
