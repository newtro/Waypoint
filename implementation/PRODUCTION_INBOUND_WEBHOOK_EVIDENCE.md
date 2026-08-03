# Production signed inbound webhook — evidence

Date: 2026-08-03

## Outcome

The narrow production vertical slice is live at the existing `waypoint-relay.johnnycode.ai` TLS origin. Enrolled workspace owners can create, rotate, revoke, kill, and delete per-device webhook channels. External senders receive a one-time signing secret and recipient public key, then submit timestamp/nonce-bound HMAC requests containing only a sealed-box ciphertext. The relay cannot decrypt the event. The desktop pulls through its authenticated relay transport, decrypts locally, and persists a quarantined review-required object with no rule, model, agent, schedule, or outbound effect.

## Local gate

- 73 test files / 333 tests passed.
- Focused webhook/migration/backup set passed 25 tests; the independent reviewer ran an expanded 27-test set.
- ESLint, TypeScript/Vite production build, `git diff --check`, dependency audit (zero vulnerabilities), dependency/license report (zero undeclared licenses), CycloneDX SBOM, native arm64 macOS directory package, and packaged-runtime import closure passed.
- Backup/restore preserves a six-day-old valid event and immutable source event ID through schema v17; actual v16→v17 migration is covered.

## Independent adversarial review

Initial findings covered owner authorization, retention mismatch, duplicate identity, channel/queue bounds, idle expiry, AES-GCM context binding, and key lifecycle. Follow-up found backup provenance/retention and future-time bounds. Repairs introduced owner-only channel administration, exact local/source identity separation, seven-day bounded import/restore, timestamp skew bounds, persistent replay protection, channel/queue quotas, purge-on-health, channel/version AES-GCM AAD, and paired database/key recovery instructions.

Final written verdict: **SHIP** — blocker 0, high 0, medium 0, low 0.

## Hosted changes and validation

- Took and integrity-checked an encrypted SQLite online backup before migration; database `quick_check` returned `ok`.
- Installed a dedicated 32-byte root-owned webhook protection key (`root:waypoint-relay`, mode 0640) plus a mode-0600 recovery copy paired with the backup. No key material was printed, logged, or committed.
- Installed versioned release `/opt/waypoint-relay/releases/live-webhook-20260803`, atomically moved `current`, added only the protected key-file environment setting, and updated only `waypoint-relay.service` with its fail-closed key condition.
- Restarted only `waypoint-relay.service`. Caddy configuration, DNS, firewall, PostgreSQL, unrelated services, and unrelated data were not changed; Caddy and PostgreSQL remained active.
- Public and loopback service health returned protocol v1 through the existing TLS/Caddy path.
- A synthetic temporary enrolled owner proved: signed acceptance (202), replay rejection (401), local sealed-box decryption, authenticated pull/ack, old-secret rejection after rotation, workspace kill rejection, channel deletion, queued-event persistence across relay restart, deliberate outage (502), and recovery to healthy service.
- The exact synthetic registry/authority/channel/event rows were removed after validation. Production finished with an intentionally empty authority registry, zero webhook channels/events, database integrity `ok`, and the live service healthy.

## Residual boundaries

No real sender, external account, work/client data, connector, model API, schedule, agent execution, outbound effect, new DNS/firewall/resource, Windows validation, or two-physical-device validation was used or authorized. A real workspace must first be enrolled before a user can create a channel. Sender-specific connector semantics remain separate authorization gates.
