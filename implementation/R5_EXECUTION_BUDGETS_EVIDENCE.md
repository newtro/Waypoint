# R5 Slice 4 — execution budget evidence

## Implemented boundary

- Added a version-1 root/child execution budget derived only in trusted main-process code from the selected workspace profile and actual request shape.
- Enforced UTF-8 prompt bytes before durable execution creation and receipt-specific stdout byte limits inside process supervision.
- Existing duration, concurrency, depth, child-count, attachment, cancellation, interruption, and no-fallback rules are represented together in each receipt.
- Recorded only numeric limits, fixed booleans, approval origin, kind/device, and a SHA-256 profile digest; no prompt, output, path, key, token, or attachment name is duplicated.
- Exposed recent receipts in Settings. Execution-event ownership supplies existing workspace isolation, export/restore, and chat cascade semantics.

## Verification

- Initial focused gate: 3 files / 32 tests, lint, and production build passed.
- Initial independent review: no-ship, blocker 0 / high 1 / medium 1 / low 1. It found the durable receipt optional, parsing insufficiently exact, and child restore coverage absent.
- Repairs make receipt creation mandatory at the store boundary, bind exact kind/origin/numeric limits and profile digest to actual lineage/effective profile, reject widened conservative profiles, and prove child receipt restoration.
- First follow-up retained one high because duration was not exact to type/profile. Parser and store now require a positive integer at the child/root ceiling and exactly `min(effective profile, type cap)`, with adversarial child/root mismatch tests.
- Final independent verdict: ship — blocker 0 / high 0 / medium 0 / low 0. Reviewer confirmed exact profile/type duration binding and reran 3 files / 32 focused tests plus diff hygiene.
- Terminal gate: 65 suites / 292 tests, lint, build, zero high dependency vulnerabilities/undeclared licenses, CycloneDX production SBOM, native arm64 macOS package, packaged runtime closure, isolated-profile native launch, and diff hygiene.
