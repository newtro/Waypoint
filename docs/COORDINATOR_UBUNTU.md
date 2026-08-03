# Ubuntu/AWS coordinator readiness guide

Waypoint's repository currently contains an opaque relay domain service and local sync/security foundations. It does **not** contain a production network listener, installer, service unit, TLS termination, AWS template, public endpoint, or completed desktop transport integration. Do not expose the current relay code to a network or treat it as a deployable coordinator.

## Intended boundary

A future user-hosted node will relay authenticated encrypted envelopes and durable deletion state. It must not receive plaintext workspace names, object IDs, document or chat bodies, filenames, prompts, CLI output, local paths, workspace keys, or model-provider credentials.

Permitted delivery metadata is limited to protocol version, opaque workspace/device identifiers, membership key epoch, immutable change ID, per-device sequence, envelope type and size, delivery cursor/timestamps, public enrollment keys, and expiring presence.

The node may still withhold, delay, reorder, partition, or reveal permitted delivery metadata. End-to-end encryption does not make the node an availability authority or eliminate traffic analysis.

## Production prerequisites

Before an Ubuntu or AWS setup guide can become operational, the release gate must provide and verify:

- a native, non-Docker installation and upgrade path;
- a least-privilege service account and explicit state directories;
- authenticated TLS, domain/DNS guidance, firewall rules, and public-network tests;
- bounded storage, message expiry, rate limits, monitoring, and disk-full behavior;
- protected node configuration with no desktop CLI or provider credentials;
- explicit enrollment approval, revocation, key rotation/re-wrapping, and recovery flows;
- encrypted snapshots plus tested restore and rollback procedures;
- fork/checkpoint detection and protocol/schema compatibility policy;
- real Mac/Windows/node convergence, interruption, replay, revocation, and anti-resurrection evidence.

## Operator rules

- Never copy a desktop workspace database, attachment directory, CLI credential, or plaintext recovery key to the node.
- Back up only the explicitly documented coordinator state, encrypted payloads, and configuration needed for recovery.
- Revoke a lost or long-offline peer before tombstone purge. Current protocol policy retains tombstones for at least 90 days and until every active peer acknowledges them.
- Remember that revocation stops future access; it cannot erase plaintext already decrypted on a lost device.
- Keep Docker optional if it is ever evaluated as a sandbox backend. It cannot become a build, setup, or runtime requirement.

Real Ubuntu/AWS provisioning, account use, TLS, public networking, node recovery, and third-party security review are deferred and require separate explicit user action.
