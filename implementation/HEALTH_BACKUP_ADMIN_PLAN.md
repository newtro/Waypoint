# Local backup administration phase

Status: acceptance frozen 2026-08-03.

## Scope and authority

This phase adds explicit local verification and non-destructive restore drills for user-selected Waypoint backups. It does not add discovery, schedules, retention automation, uploads, cloud storage, external network calls, path retention, or live-workspace replacement. Backup creation remains an explicit plaintext export to a user-selected path.

## Acceptance gate

- Verification is read-only and checks the bounded archive format/version, envelope integrity, workspace identity, plausible timestamps, allowlisted schema, embedded attachment/audio digests, and aggregate object counts.
- A restore drill imports through the real restore path into an isolated temporary database and artifact directory, then checks SQLite/FK integrity, file presence/digests, search-index parity, and per-family counts.
- Temporary drill data is removed on success and failure. Cleanup failure is explicit and actionable.
- Renderer output contains only the selected basename, archive version/export time, bounded aggregate counts, pass/failure code, and remediation—never content, absolute paths, keys, prompts, or raw errors.
- Verify/drill are explicit Settings actions and cannot overwrite or mutate the live workspace.
- Corruption, unsupported/future versions, future timestamps, size limits, I/O failures, restore failures, and cleanup failures are truthful and fail closed.
- Focused/full tests, lint, production build, dependency/SBOM checks, native macOS package/runtime/launch, diff hygiene, and an independent severity-rated review pass.

## Deferred gates

Encrypted backups, automatic schedules/retention, destination bookmarks, remote/cloud destinations, peer backup, restore-over-live, Windows-native behavior, and signed release require separate product/security/platform authority and review.
