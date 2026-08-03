# P6B Generic Tool Gateway — acceptance evidence

Date: 2026-08-03

## Delivered local vertical slice

- Versioned trusted-main-process tool requests and minimized durable receipts for workspace reads, interactive terminal/local CLI execution, and Waypoint domain commands.
- Canonical-root and symlink containment, strict tool discriminants, per-workspace budgets, durable running/terminal states, cancellation/global stop, and POSIX process-group TERM→KILL escalation.
- Secret-aware bounded output reassembly/redaction. Live progress exposes byte counts rather than raw stream chunks and is routed only to renderer windows scoped to the receipt workspace.
- `git`, `gh`, and `az` discovery uses installed local identities without new credential storage. PR/deployment/account setup remains explicitly unavailable.
- Domain-only `AiWaypointControlBridge` with shared UI/AI validation for workspace summary, chat creation, and memory creation. It is an adapter seam, not a connected hosted-provider path.
- Durable Codex/Claude chat execution timeline derived only from available structured events, including Claude tool completion/failure normalization and truthful no-event states.
- Workspace-cascade persistence, backup/restore, settings/status/receipts UI, and typed unavailable seams for browser, hosted providers, and cross-device execution.

## Security decision made during review

The initially proposed AI-origin inherited terminal was rejected. A hostile model can use an unrestricted interpreter or authenticated CLI to export environment/Keychain-backed credentials; lexical command filters and output redaction cannot enforce the “never export or relay secrets” boundary. P6B therefore permits inherited terminal/local CLI execution only from an explicit interactive UI origin and fails closed for AI origin. Hosted-model terminal use requires a later OS-enforced no-exfiltration boundary or a separately approved policy revision. Domain commands remain available through the trusted-main bridge.

## Verification

- Focused repaired gateway/workbench gate: 17 tests passed.
- Full repository gate: 74 files / 344 tests passed.
- ESLint: passed with no warnings.
- TypeScript/Vite production build: passed.
- Dependency policy verification and SBOM generation: passed before review; no dependency was added by the repair.
- macOS arm64 directory package and packaged runtime import closure: passed.
- Packaged app launched with an isolated temporary Chromium data directory and exited cleanly.
- Diff whitespace check: passed.

## Independent adversarial review

Initial verdict: NO-SHIP — 1 blocker, 5 high, 2 medium. Material findings covered AI credential exfiltration, unknown-tool fail-open dispatch, incomplete descendant cancellation, split-stream secret leakage, stranded running receipts, and an absent AI domain adapter seam.

After repair, the independent reviewer reran the hostile suite (17/17) and returned **SHIP: 0 blocker, 0 high, 3 medium, 1 low**.

Residuals:

- Medium: the AI bridge is intentionally not connected to a hosted provider because no hosted provider/API activation is authorized; do not claim a live provider control path.
- Medium: broad ordinary-UI parity and non-security preference mutation are not part of this slice; the implemented allowlist is summary/chat-create/memory-create only.
- Medium: Windows descendant-tree termination requires a Windows-specific mechanism and remains platform-contingent.
- Low: a future multi-workspace/multi-window shell should replace the current one-workspace-per-renderer progress subscription with explicit subscription sets.

Gate result: clean for the bounded native macOS P6B vertical slice. No external service, account, credential, deployment, or user workspace was touched.
