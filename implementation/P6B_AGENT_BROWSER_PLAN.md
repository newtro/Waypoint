# P6B follow-on — model-neutral Agent Browser

Status: Browser Completion implementation and packaged acceptance complete; Windows native validation remains platform-contingent.

## Product decision

- Vercel Labs `agent-browser` is the preferred interactive browser backend. Microsoft Playwright CLI remains a deterministic E2E/regression-trace tool and is not the agent-browser implementation.
- The workspace policy selects either `existing` (an explicit private snapshot of a user-selected Brave/Chrome/Edge profile) or `isolated` (a Waypoint-owned in-app session). Brave is first-class. Firefox is shown truthfully as unavailable unless its own containment backend is validated.
- Browser output uses content-boundary markers, allowed-domain/action policy, bounded JSON output, cancellation/global stop, redacted receipts, and the existing failure-learning lifecycle. No cookies, passwords, tokens, storage state, or raw browser profile data enter prompts, receipts, backup, sync, or relay payloads.
- No cloud browser provider is enabled. Kernel, AgentCore, remote CDP, and arbitrary profile/state import are outside this local slice.

## Acceptance gate

1. Pin an audited Apache-2.0 release and its integrity/provenance; package native macOS arm64/x64 and Windows x64 binaries without requiring global Node, npm, a terminal, or a separate Chrome download.
2. Prove app-managed Chrome-for-Testing or compatible-browser closure, update/removal, offline launch, and package size. No silent browser/model/runtime download.
3. Persist the user-only profile mode per workspace/device. Existing-profile mode uses a bounded, cache-excluding, non-mutating Waypoint snapshot with a provenance manifest and atomic replacement. Isolated mode uses a nonpersistent Electron partition and explicit Clear/Close controls.
4. Expose a narrow typed command set (open, snapshot, click, non-secret type, select, bounded workspace upload, screenshot, wait, close), domain/action bounds, visible headed state, progress/cancel/stop, minimized receipts, and deterministic failure states. Selectors are snapshot references only; arbitrary flags, script evaluation, downloads, clipboard, cookies, raw CDP, and secret entry remain unavailable.
5. Threat-test prompt injection, hostile page output, domain redirects, `file:`/local-network access, downloads/uploads, clipboard, dialogs, profile crossover, CDP discovery, stale sessions, output exhaustion, secret fields, and cancellation/process cleanup.
6. Package and inspect macOS; Windows runtime validation remains hardware-contingent. Obtain an independent severity-rated verdict and repair all blocker/high findings.

## Completion evidence and residual boundaries

- Waypoint packages `agent-browser 0.33.2` and Playwright Chromium 151 as a 344-entry, independently anchored closure with Agent Browser/Playwright license notices and source provenance. The macOS arm64 nested Chromium bundle passes strict code-sign verification; full Waypoint release signing/notarization and Windows native validation remain platform/release gates.
- The user-visible Waypoint In-App Browser is embedded with address/navigation/loading/error/workspace/profile state and explicit Close/Clear controls. It is opt-in through a public-domain list, HTTPS-only, permission-denying, and routed through a Waypoint loopback CONNECT gate that re-resolves and rejects private/special-use destinations.
- Normal chat accepts typed browser actions and records ordered, redacted, chat-associated progress and durable terminal provenance. Cancel and Global Stop abort in-flight work and terminal races are deduplicated.
- Installed Brave/Chrome/Edge discovery and profile selection are explicit. Import copies a bounded private snapshot into app storage; cache trees and symbolic/special filesystem entries are rejected, provenance is hashed, replacement is atomic, and a user-visible removal action returns to isolated mode. Firefox remains detected-but-unavailable until separately validated.
- Global Stop, browser-authority changes, data clearing, and application shutdown await the typed browser close action before revoking the network gate or deleting local state. Clear failure is reported truthfully rather than claiming completion.
- Existing signed-in sessions run only from the Waypoint-owned snapshot through the controlled proxy. The original browser profile is never automated or mutated, and Settings warns users to close the source browser before refreshing the snapshot.
- Protected/secret form entry remains unavailable because values must not be exposed through process arguments. Typed interaction is limited to explicitly non-secret bounded text.
- Isolated browser storage is intentionally ephemeral rather than restored across app restarts. This is a privacy choice; durable chat receipts/provenance persist independently. Windows runtime validation remains required on Windows hardware.
