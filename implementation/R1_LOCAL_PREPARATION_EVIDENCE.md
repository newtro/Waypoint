# R1 secure relay local-preparation evidence

## Implemented locally

- Restart-safe SQLite opaque queue with synchronous durability, authority/signature injection, immutable message and monotonic sender sequence protection, transaction-serialized quotas, canonical expiry, authenticated-recipient-bound pull/ack, revocation filtering, schema compatibility, disk reserve, and content-free aggregate health.
- Strict non-secret configuration parser requiring bounded unprivileged port and absolute database/TLS paths.
- Native hardened authority-conditioned systemd/preflight artifacts and example environment; they refuse to start a listener before an approved authority composition exists and have no Docker dependency.
- Inert CloudFormation definition with explicit VPC/subnet/ARM64 instance/client CIDR, IMDSv2, encrypted retained EBS, localhost-only fail-closed egress, and a prominent not-authorized tag.
- Operations runbook for least-privilege install, TLS, upgrade/rollback, consistent encrypted backup/restore, disk pressure, outage/corruption, content-minimized logs/health, and explicitly authorized teardown.
- Vitest now includes `node/` and `deploy/` suites so relay and deployment checks cannot silently escape the repository gate.

## Honest boundary

This is local preparation, not the canonical R1 exit. No network listener, production enrollment authority, hosted TLS, AWS resource, DNS, backup target, public firewall, real Mac↔Mac transport, Ubuntu native execution, load/soak, or disaster restore has been claimed. The systemd unit is deliberately conditioned on a future authority registry and the entrypoint exits with configuration status 78; it is not represented as a runnable hosted relay.

## Verification and review

- Focused relay/deployment gate: 4 suites / 17 tests.
- Full repository gate: 39 suites / 196 tests; lint and production build pass.
- Dependency audit: zero vulnerabilities at high threshold.
- Native macOS package and packaged-runtime import closure pass; package remains unsigned as expected.
- Independent first pass: blocker 1, high 5, medium 5. Repairs corrected default AWS egress, nonexistent/looping entry behavior, recipient impersonation and revoked-recipient quota abuse, non-canonical retention, transaction races, unsupported snapshot policies, instance architecture ambiguity, schema compatibility, disk-pressure/idempotency, CIDR validation, ciphertext inspection, and backup/restore coverage. Final independent verdict after mechanical evidence correction: clean pass, blocker 0 / high 0 / medium 0 / low 0.
