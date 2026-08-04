# P6B Generic Tool Gateway — acceptance evidence

Date: 2026-08-03

## Delivered local vertical slice

- Versioned trusted-main-process tool requests and minimized durable receipts for bounded workspace list/read/search/atomic write, terminal/local CLI execution, and Waypoint domain commands.
- Canonical-root and symlink containment, strict tool discriminants, per-workspace budgets, durable running/terminal states, cancellation/global stop, and POSIX process-group TERM→KILL escalation.
- Secret-aware bounded output reassembly/redaction. Live progress exposes byte counts rather than raw stream chunks and is routed only to renderer windows scoped to the receipt workspace.
- `git`, `gh`, and `az` discovery uses installed local identities without new credential storage. PR/deployment/account setup remains explicitly unavailable.
- Policy-governed `AiWaypointControlBridge` with shared UI/AI validation for ordinary domain and local workspace tools. Security-critical domain commands still fail closed. It is an adapter seam, not a connected hosted-provider path.
- Durable Codex/Claude chat execution timeline derived only from available structured events, including Claude tool completion/failure normalization and truthful no-event states.
- Workspace-cascade persistence, backup/restore, settings/status/receipts UI, and typed unavailable seams for browser, hosted providers, and cross-device execution.

## Security decision made during review

The original bounded slice denied AI-origin terminal execution. The later Full Coding Workstation phase supersedes that decision for an explicitly trusted Autonomous Developer workspace: UI and AI now share the same user-managed deny list, budgets, stop/cancel, receipts, redaction, workspace roots, and installed-local-CLI path. This is powerful local authority, not an OS-enforced no-exfiltration sandbox. Deny patterns are user safety policy, not a malicious-command security boundary: an unrestricted shell can invoke installed programs and use the inherited local identity. Waypoint never intentionally copies environment or Keychain values into prompts, receipts, backup, sync, or relay data, and it bounds/redacts captured output; users must enable this profile only for models and workspaces they trust.

## Verification

- Full Coding Workstation extension focused gate: 3 files / 43 tests passed.
- Full repository gate after repair: 103 files / 466 tests passed.
- macOS arm64 directory package rebuilt successfully after repair; signing remains release-identity contingent.
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

Full Coding Workstation extension re-review initially found four highs: unbounded search, a false file rollback reference, incomplete new-tool lifecycle allowlists, and overclaimed shell isolation. Search is now bounded by matches/visits/bytes/depth/time, writes no longer advertise unavailable rollback, backup/restore/failure learning recognize both new tools, and UI/docs state the trusted-shell boundary explicitly. Final independent verdict: **0 blocker / 0 high**.
