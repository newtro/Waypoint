# R1 hosted relay deployment evidence

## Deployed vertical slice

- Host: existing user-owned Ubuntu 24.04 x64 Lightsail VM at the approved address; no new cloud resource or incremental hosting cost was created.
- Endpoint: `https://waypoint-relay.johnnycode.ai`, one DNS-only A record and one marker-bounded Caddy site. Caddy was backed up, validated, and reloaded only; it was never restarted. TLS 1.3 is required. Direct port 8789 is unreachable publicly.
- Runtime: dedicated locked `waypoint-relay` identity, loopback `127.0.0.1:8789`, dedicated `/opt`, `/etc`, and mode-0700 `/var/lib` paths, hardened systemd unit, bounded memory/tasks/files, no Docker and no PostgreSQL.
- Transport: signed canonical requests bind protocol, workspace, device, key epoch, method/path, timestamp, nonce, and body digest. Device signatures use the strict root-owned public authority registry. Nonces persist across restart; pull/ack are authenticated-recipient-bound; rate and concurrency limits are bounded.
- Backup: daily persistent timer, AES-256-GCM authenticated encryption, content-free digest, 14-day maximum retention, mode-0600 artifacts, and an isolated authenticated decrypt/SQLite integrity drill. Key and backup share the host, so this is operational rollback protection, not host-compromise or disaster protection.

## External changes

1. Tightened the supplied local SSH private-key permission from 0644 to 0600 and accepted the approved host key.
2. Created DNS A record `waypoint-relay.johnnycode.ai -> 98.93.243.79` with Cloudflare proxy disabled.
3. Appended only the marker-bounded Waypoint Caddy block; retained timestamped pre-change Caddy backups; validated and reloaded Caddy.
4. Created the `waypoint-relay` system user/group, release/config/state paths, service, backup service/timer, and local backup key.
5. Did not alter/restart PostgreSQL, create a database, touch unrelated sites/services/data, create AWS resources, or expose another port.

## Verification

- Local: 41 suites / 201 tests, lint, TypeScript/Vite build, zero-vulnerability high audit, and diff-check pass.
- Public TLS: valid chain and hostname; TLS 1.2 handshake rejected and TLS 1.3 accepted; HSTS/no-sniff/no-referrer headers present.
- Same-Mac isolated identities over the real public hostname: bidirectional signed encrypted enqueue/pull/decrypt/ack, cross-principal pull/ack denial, durable nonce replay denial, restart persistence, revocation denial, and old-epoch denial pass.
- Native host: service restart changes PID and preserves queue/replay state; malformed authority registry exits 78 without restart/log loop, then atomic restore succeeds; loopback binding and direct-port timeout verified.
- Backup: digest, AEAD decrypt, SQLite `quick_check`, sequence/nonce state, tamper rejection, 14-day deletion boundary, restrictive permissions, and plaintext-sentinel absence in live SQLite, journal, and restored backup pass.
- Shared safety: Caddy and PostgreSQL 16 remained active throughout; no Caddy/PostgreSQL restart occurred.

## Independent review

- First hosted pass identified one canonical blocker, four high, and three medium findings. Repairs removed false direct-TLS support, bound principal headers into signatures, rejected signing-key aliases, isolated authenticated capacity from proxy load, added AES-GCM backup authentication and conservative retention, cached/rate-limited real health, required TLS 1.3, and proved bounded malformed-registry failure.
- A second pass found two remaining highs in health-scan amplification and cleanup timing; both were repaired and re-verified.
- Final hosted vertical-slice verdict: clean pass, blocker 0 / high 0 / medium 0 / low 0.
- Canonical R1 verdict: blocker 1 / high 0 / medium 0 / low 0 for the product/key-lifecycle and physical app-integrated peer matrix below.

## Remaining canonical R1 blocker

This proves the hosted transport vertical slice, not the entire canonical R1 product exit. The current desktop app still lacks the reviewed one-use enrollment/device-management/key-rotation workflow and actual peer transport integration. Only one physical Mac is available, so the required two-physical-Mac app matrix—attachments, concurrent edits/conflicts, deletion convergence/re-enrollment, outage and recovery—has not run. Windows remains platform-contingent. The deployed authority registry is intentionally empty after validation; actual devices cannot connect until that workflow is implemented and explicitly enrolled.
