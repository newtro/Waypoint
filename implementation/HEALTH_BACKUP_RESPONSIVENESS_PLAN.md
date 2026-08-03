# Health/Backup Slice 2 — responsive administration

Status: acceptance frozen 2026-08-03.

## Scope

Move the existing explicit local backup inspection and isolated restore drill out of Electron's UI/main thread. Preserve Slice 1's archive, privacy, isolation, and cleanup contracts. No backup discovery, encryption, schedule, retention automation, destination persistence, upload, network call, or live-workspace restore is authorized.

## Acceptance gate

- Backup inspection and restore drills execute in a dedicated local worker; Electron's main event loop does not parse, hash, write, or query the selected archive.
- At most one backup-administration operation runs per app instance. A concurrent request fails immediately with a stable, truthful busy result.
- Worker messages are validated as the narrow result contract. Worker start/error/abnormal-exit failures return only basename, stable code, and remediation; no raw exception, content, or absolute path crosses to the renderer.
- Verification stays read-only. Restore drills keep the production restore path, isolated temporary database/artifact root, complete family/integrity checks, and independent close/removal attempts.
- Focused tests cover asynchronous completion, concurrency, malformed/crashed-worker behavior, and actual compiled-worker verification/drill behavior.
- Full tests, lint/build, dependency/SBOM checks, native macOS package/runtime/launch, diff hygiene, and independent severity-rated review pass with no blocker/high finding.

## Recorded gates

Signed webhook ingress and calendar/connectors require external network/account authority. Backup encryption/automatic retention require user policy and key-recovery decisions. Mobile, peer execution, Windows, signing, distribution, and physical-device validation remain separately gated.
