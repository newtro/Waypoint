# P6B follow-on — model-neutral Agent Browser

Status: implementation-ready; runtime unavailable in the current package until the closure gate passes.

## Product decision

- Vercel Labs `agent-browser` is the preferred interactive browser backend. Microsoft Playwright CLI remains a deterministic E2E/regression-trace tool and is not the agent-browser implementation.
- The workspace policy selects either `existing` (a read-only snapshot of a user-selected signed-in Chrome profile) or `isolated` (a Waypoint-owned persistent profile). The selection is visible per invocation and security-critical profile changes remain user-only.
- Browser output uses content-boundary markers, allowed-domain/action policy, bounded JSON output, cancellation/global stop, redacted receipts, and the existing failure-learning lifecycle. No cookies, passwords, tokens, storage state, or raw browser profile data enter prompts, receipts, backup, sync, or relay payloads.
- No cloud browser provider is enabled. Kernel, AgentCore, remote CDP, and arbitrary profile/state import are outside this local slice.

## Acceptance gate

1. Pin an audited Apache-2.0 release and its integrity/provenance; package native macOS arm64/x64 and Windows x64 binaries without requiring global Node, npm, a terminal, or a separate Chrome download.
2. Prove app-managed Chrome-for-Testing or compatible-browser closure, update/removal, offline launch, and package size. No silent browser/model/runtime download.
3. Persist the user-only profile mode per workspace/device. Existing-profile mode must use the upstream copy/snapshot behavior and never mutate the source profile; isolated mode remains under Waypoint-owned local storage.
4. Expose a narrow typed command set (open, snapshot, click, fill, wait, screenshot, close), domain/action bounds, visible headed state, progress/cancel/stop, minimized receipts, and deterministic failure states.
5. Threat-test prompt injection, hostile page output, domain redirects, `file:`/local-network access, downloads/uploads, clipboard, dialogs, profile crossover, CDP discovery, stale sessions, output exhaustion, secret fields, and cancellation/process cleanup.
6. Package and inspect macOS; Windows runtime validation remains hardware-contingent. Obtain an independent 0-blocker/0-high verdict before marking the capability available.

## Current evidence and blocker

- The local machine has `agent-browser 0.9.0`; it is not treated as a production-ready Waypoint runtime.
- Current npm metadata reports `agent-browser 0.33.2`, Apache-2.0, about 91 MB unpacked, and Node >=24/pnpm >=11 for the package wrapper. Waypoint's development runtime is Node 22, so exact native-binary/package closure must be proven rather than assumed.
- Until that gate passes, Settings truthfully reports browser control unavailable. No browser process, profile, account, or external page was accessed in recording this decision.
