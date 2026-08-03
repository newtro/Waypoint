# Local backup administration evidence

Status: phase gate passed 2026-08-03.

Implemented:

- Read-only local archive inspection with sanitized aggregate results.
- Envelope, workspace, timestamp, schema, attachment, and meeting-audio integrity checks.
- Isolated real-path restore drill with database, foreign-key, artifact, digest, search-index, and count checks.
- Guaranteed best-effort temporary cleanup with explicit cleanup failure.
- Explicit Verify backup and Run restore drill actions in Settings.

No external service, credential, network call, schedule, live restore, or user-data reset was introduced.

Independent review initially found two highs, two mediums, and one low. Repairs compare every one of the 21 portable families (including the explicit restore-generated activity delta), independently attempt database close and directory removal, validate timestamp ordering, clean test fixtures, and prove removal after a simulated close failure. Final verdict: blocker 0 / high 0 / medium 1 / low 1.

The accepted medium is responsiveness only: an explicitly selected archive up to the existing 256 MiB limit is synchronously parsed/restored in Electron's trusted process and can temporarily freeze the UI. Moving administration work off-main is a later hardening slice; it does not weaken data integrity, isolation, cleanup, or authority. The low is missing direct meeting-audio/removal-failure branch coverage; both branches fail closed and share reviewed mechanisms.

Terminal evidence: 66 suites / 299 tests, lint, production build, zero reported dependency vulnerabilities and zero undeclared licenses, production SBOM, native arm64 macOS package/runtime closure and isolated-profile launch, plus clean diff hygiene.
