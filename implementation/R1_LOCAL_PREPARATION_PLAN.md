# R1 secure relay — local preparation gate

## Implementable scope

1. Native Docker-free Ubuntu service artifacts and strict non-secret configuration contract.
2. Restart-safe SQLite opaque queue with authenticated-authority injection, protocol/ID/lifetime/quota enforcement, recipient-scoped acknowledgement, expiry, health, and content-free state.
3. Inert AWS infrastructure definition with encrypted durable storage, IMDSv2, explicit CIDR ingress, and no default egress.
4. Install, upgrade, rollback, backup/restore, disaster, disk-pressure, TLS, patching, and teardown runbooks that stop at explicit authority gates.
5. Local fixtures for restart, replay, revocation, quota, expiry, configuration, deployment hardening, and plaintext inspection.

## Local exit gate

Focused/full tests, lint, build, audit, package closure, artifact validation, and independent security/operations review have no unresolved blocker/high. This gate does not satisfy the canonical real-host or real two-peer R1 exit.
