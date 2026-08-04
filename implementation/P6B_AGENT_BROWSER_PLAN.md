# P6B follow-on — model-neutral Agent Browser

Status: packaged read/navigation Preview implemented. Interactive actions, existing-profile snapshots, and persistent isolated restore remain tracked repair-required work; this is not a deferral or removal.

## Product decision

- Vercel Labs `agent-browser` is the preferred interactive browser backend. Microsoft Playwright CLI remains a deterministic E2E/regression-trace tool and is not the agent-browser implementation.
- The workspace policy selects either `existing` (a read-only snapshot of a user-selected signed-in Chrome profile) or `isolated` (a Waypoint-owned persistent profile). The selection is visible per invocation and security-critical profile changes remain user-only.
- Browser output uses content-boundary markers, allowed-domain/action policy, bounded JSON output, cancellation/global stop, redacted receipts, and the existing failure-learning lifecycle. No cookies, passwords, tokens, storage state, or raw browser profile data enter prompts, receipts, backup, sync, or relay payloads.
- No cloud browser provider is enabled. Kernel, AgentCore, remote CDP, and arbitrary profile/state import are outside this local slice.

## Acceptance gate

1. Pin an audited Apache-2.0 release and its integrity/provenance; package native macOS arm64/x64 and Windows x64 binaries without requiring global Node, npm, a terminal, or a separate Chrome download.
2. Prove app-managed Chrome-for-Testing or compatible-browser closure, update/removal, offline launch, and package size. No silent browser/model/runtime download.
3. Persist the user-only profile mode per workspace/device. Existing-profile mode must use the upstream copy/snapshot behavior and never mutate the source profile; isolated mode remains under Waypoint-owned local storage. The current preview is intentionally ephemeral across restarts because upstream rejects `--allowed-domains` together with restore state; persistence remains repair-required until both controls can coexist.
4. Expose a narrow typed read/navigation preview command set (open, snapshot, wait, close), domain/action bounds, visible headed state, progress/cancel/stop, minimized receipts, and deterministic failure states. Clicking and form filling remain tracked repair-required work until action authorization and protected input prevent unintended effects and OS-command-line disclosure.
5. Threat-test prompt injection, hostile page output, domain redirects, `file:`/local-network access, downloads/uploads, clipboard, dialogs, profile crossover, CDP discovery, stale sessions, output exhaustion, secret fields, and cancellation/process cleanup.
6. Package and inspect macOS; Windows runtime validation remains hardware-contingent. Obtain an independent 0-blocker/0-high verdict before marking the capability available.

## Current evidence and residual repair path

- Waypoint packages `agent-browser 0.33.2` and Playwright Chromium 151 as a 344-entry, independently anchored closure with Agent Browser/Playwright license notices and source provenance. The macOS arm64 nested Chromium bundle passes strict code-sign verification; full Waypoint release signing/notarization and Windows native validation remain platform/release gates.
- The read/navigation Preview is opt-in through an explicit public-domain list, isolated under a per-workspace Waypoint home, HTTPS-only, and routed through a Waypoint loopback CONNECT gate that re-resolves and rejects private/special-use destinations. A real packaged trace opened and snapshotted `https://example.com`, then closed without a residual session.
- Global Stop, browser-authority changes, data clearing, and application shutdown await the typed browser close action before revoking the network gate or deleting local state. Clear failure is reported truthfully rather than claiming completion.
- Existing-profile snapshots, persistent restore, click, and protected form input remain named repair-required capabilities. Upstream refuses restore together with domain allowlisting, and secret form values cannot be placed on the OS command line. These limitations are not treated as feature abandonment.
