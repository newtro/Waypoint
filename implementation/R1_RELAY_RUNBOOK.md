# Waypoint relay operations runbook

## Hosted authority and shared-VM boundary

The user authorized the existing shared Lightsail VM and dedicated `waypoint-relay.johnnycode.ai` endpoint. Do not create another host, broaden firewall rules, restart Caddy/PostgreSQL, or touch unrelated sites. Authority registry updates are root-written to a same-directory temporary file, schema-validated by a bounded preflight, atomically renamed, and applied by restarting only `waypoint-relay.service`. A malformed registry must exit 78 without an automatic restart loop.

## Native install and hardening

Target Ubuntu 24.04 LTS. The authorized shared host is x64; the inert t4g CloudFormation alternative remains ARM64. Verify runtime architecture, create a locked `waypoint-relay` system user with no shell, copy a verified build to a versioned `/opt/waypoint-relay/releases` directory, and keep configuration root-owned and state mode 0700. TLS terminates only at the dedicated Caddy hostname and the relay binds loopback. `MemoryDenyWriteExecute` is not used because Node/V8 and libsodium WASM require executable-memory transitions; the remaining sandbox and resource controls stay enabled.

Terminate public TLS either in the reviewed service or an explicitly approved same-host reverse proxy. Require TLS 1.3, an approved hostname, automated renewal with failure alerting, and a client-visible certificate-chain test. Never expose the loopback example configuration publicly.

## Upgrade and rollback

1. Stop intake and wait for the bounded in-flight request count to reach zero.
2. Take an encrypted, integrity-stamped relay backup and verify it on an isolated restore directory.
3. Install into a new versioned `/opt/waypoint-relay/releases/<version>` directory; never overwrite the active release.
4. Run configuration/schema compatibility and local health checks, atomically switch `current`, restart, then exercise enrollment-disabled health and an authorized synthetic delivery.
5. On failure, stop, restore the prior binary and compatible database snapshot, restart, and verify queue counts/digests. Never downgrade across an unsupported schema.

## Backup, restore, and disaster

Use SQLite's online backup mechanism; never copy live WAL files ad hoc. The deployed local rollback uses AES-256-GCM authenticated encryption and a protected same-host key, records only content-free digest metadata, enforces a 14-day ceiling, and requires a verified isolated restore. Because key and ciphertext share one host, this is not disaster- or host-compromise-resistant; an off-host destination requires a later explicit storage/custody decision. A restore must preserve opaque envelope bytes and replay state and never supplies workspace plaintext or recovery passphrases.

Production inbound channels additionally require `/etc/waypoint-relay/webhook.key`: exactly 32 random bytes, owned `root:waypoint-relay`, mode 0640, readable by the relay but never logged or committed. It encrypts channel signing secrets with channel/version-bound AES-256-GCM; it is not an event decryption key. Before a live schema upgrade, place a mode-0600 root-owned recovery copy beside the encrypted relay backup, verify its SHA-256 out of logs, and restore key plus database as one generation. Losing or mismatching it requires revoking/recreating every webhook channel; never generate a replacement over an existing database. Rotation is a separate maintenance ceremony: kill intake, create and distribute new channel secrets, verify drained queues, revoke old channels, then replace the master only after no old protected secret remains.

For disk pressure, reject new intake before reserve exhaustion while preserving pull/ack/health; never delete unexpired unacknowledged messages to recover space. For corruption, stop writes, preserve evidence, restore the last verified snapshot, and let clients replay durable outboxes. For node outage, clients continue local work.

## Logs and health

Log only timestamp, severity, content-free event code, protocol version, truncated/random request correlation, counts, sizes, duration, and status. Never log payload bytes, full opaque IDs, public keys, signatures, filenames, prompts, paths, credentials, or raw exceptions. Health returns protocol version, queue counts/bytes, storage readiness, and no workspace/device identifiers.

## Teardown

Require a final verified backup decision, revoke public ingress, stop the service, destroy TLS/host credentials, snapshot or cryptographically erase storage according to the approved retention choice, delete DNS only after clients are disabled, and record residual backups/snapshots and their expiry. Cloud resource deletion is a separate explicit destructive authorization.
