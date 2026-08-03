# Waypoint relay operations runbook

## Authority stop

Do not run the AWS template or create hosts, DNS, certificates, firewall rules, backups, or monitoring until the user supplies the exact account, region, cost ceiling, domain, approved client CIDRs, credential mechanism, backup destination/retention, and teardown authority. Employer networks are forbidden without employer approval.

## Native install and hardening

Target Ubuntu 24.04 LTS on ARM64 for the frozen t4g artifact. Verify the AMI publisher/digest and architecture, apply security updates, create a locked `waypoint-relay` system user with no shell, install pinned Node 22.16, copy a verified build to `/opt/waypoint-relay`, create root-owned mode-0750 configuration and mode-0700 state/TLS directories, validate `relay.env` without secrets, then install the reviewed systemd unit. The unit remains inactive until an independently reviewed authority composition installs `/etc/waypoint-relay/authority.json`; the current entrypoint is a fail-closed preflight, not a network listener. The TLS private key is root/relay-group readable only and never enters the environment, logs, backup manifest, or repository.

Terminate public TLS either in the reviewed service or an explicitly approved same-host reverse proxy. Require TLS 1.3, an approved hostname, automated renewal with failure alerting, and a client-visible certificate-chain test. Never expose the loopback example configuration publicly.

## Upgrade and rollback

1. Stop intake and wait for the bounded in-flight request count to reach zero.
2. Take an encrypted, integrity-stamped relay backup and verify it on an isolated restore directory.
3. Install into a new versioned `/opt/waypoint-relay/releases/<version>` directory; never overwrite the active release.
4. Run configuration/schema compatibility and local health checks, atomically switch `current`, restart, then exercise enrollment-disabled health and an authorized synthetic delivery.
5. On failure, stop, restore the prior binary and compatible database snapshot, restart, and verify queue counts/digests. Never downgrade across an unsupported schema.

## Backup, restore, and disaster

Use SQLite's online backup mechanism while the service is quiesced or a reviewed consistent snapshot path; never copy live WAL files ad hoc. Encrypt backups with an operator-owned key outside the host, record version/time/byte count/integrity only, cap retention at 14 days, deny public access, and test restore before considering a backup valid. A restore must preserve opaque envelope bytes, sequence replay protection, invitation consumption, membership/key epochs, and acknowledgements; it never supplies workspace plaintext or recovery passphrases.

For disk pressure, reject new intake before reserve exhaustion while preserving pull/ack/health; never delete unexpired unacknowledged messages to recover space. For corruption, stop writes, preserve evidence, restore the last verified snapshot, and let clients replay durable outboxes. For node outage, clients continue local work.

## Logs and health

Log only timestamp, severity, content-free event code, protocol version, truncated/random request correlation, counts, sizes, duration, and status. Never log payload bytes, full opaque IDs, public keys, signatures, filenames, prompts, paths, credentials, or raw exceptions. Health returns protocol version, queue counts/bytes, storage readiness, and no workspace/device identifiers.

## Teardown

Require a final verified backup decision, revoke public ingress, stop the service, destroy TLS/host credentials, snapshot or cryptographically erase storage according to the approved retention choice, delete DNS only after clients are disabled, and record residual backups/snapshots and their expiry. Cloud resource deletion is a separate explicit destructive authorization.
