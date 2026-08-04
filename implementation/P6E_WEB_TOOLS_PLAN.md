# P6E — Controlled Web Search and Fetch

## Acceptance gate

- `web.search` returns bounded Brave Search results with titles, snippets, and explicit source URLs only after a user stores an OS-protected key and opts the workspace in.
- `web.fetch` retrieves only bounded public HTTPS HTML/plain-text pages after workspace opt-in; every redirect is revalidated.
- Both tools use the model-neutral Tool Gateway, receipts, activity timeline, failure learning, cancellation/global stop, backup/restore, sync policy, workspace deletion, budgets, and redaction.
- Localhost, private/link-local/reserved networks, IP literals, credentials, non-443 ports, non-HTTPS/file schemes, unsafe redirects, active markup, unsupported MIME types, and oversized bodies fail closed.
- Settings truthfully show provider/key/readiness state. No background or paid request is made during setup or verification.
- Focused/full tests, lint/build, packaged macOS closure, and severity-rated independent review complete with no unresolved blocker/high finding.

## Product decision

Brave Search API is the first transparent search provider because it returns source-attributed results through a documented API. Its key is device-local OS-protected secret material and is excluded from backup, sync, relay, logs, receipts, and UI display. Direct fetch has no key but remains an explicit per-workspace external-data policy. Fetched content is always labeled untrusted data and never grants tool authority.

## Evidence

- Focused gate: 5 suites / 48 tests passed after repairs to backup restore, protected-key readiness, policy persistence, policy-digest provenance, pinned-socket DNS rebinding defense, and identity response encoding.
- Whole product: 106 suites / 477 tests passed; ESLint, production TypeScript/Vite build, `npm audit` (0 vulnerabilities), and unpacked macOS arm64 packaging passed.
- Independent adversarial review terminal verdict: 0 blocker, 0 high, 2 medium. Residual medium hardening is per-workspace rather than global web concurrency accounting and an interruptible/bounded DNS resolver path. Both fail boundedly and are tracked; neither grants private-network access or leaks a secret.
- Package note: macOS arm64 package closure completed. Distribution signing remains unavailable because no valid Developer ID identity is installed; no release/publish claim is made.
