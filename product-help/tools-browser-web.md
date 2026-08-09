# Tools, browser, and web access

Waypoint’s Tool Gateway is a model-neutral, trusted-main policy boundary. It exposes bounded tools and Waypoint domain commands with status, cancellation, receipts, failure learning, workspace scope, and a global Stop. Codex and Claude keep their own native tool loops; Waypoint adds visibility and a thin bridge for Waypoint-specific controls.

## Coding and local CLI tools

Trusted Autonomous Developer workspaces can run local terminal and installed CLI tools under the configured workspace/device policy and user deny list. Existing Git, GitHub CLI, Azure tooling, and similar local identities are preferred over duplicate credential storage. Receipts are bounded and redacted.

Commit and push can be permitted for a trusted workspace with visible notification. Pull requests and deployments require a direct user request. External accounts are never created merely because a CLI is installed.

## Browser modes

The default contained mode uses a Waypoint-managed isolated browser session. The In-App Browser provides visible navigation, current workspace/session state, loading/error state, stop/close/clear controls, screenshots, and tool activity.

Installed Chromium-family browsers such as Brave, Chrome, or Edge may be discovered. Existing signed-in profile use is always an explicit user selection with a warning and a contained snapshot/session boundary; it is never silently activated. Firefox is shown only when its backend is genuinely supported, otherwise its reason remains visible.

Browser tools can navigate, inspect, click, type ordinary text, select, perform user-authorized bounded uploads, wait, screenshot, and close within policy. They do not reveal passwords, cookies, tokens, or Keychain contents. Secure secret-field handoff remains unavailable unless a dedicated non-model path exists.

## Web Search and Web Fetch

Web Search requires a user-configured protected search provider key and explicit enablement. Web Fetch retrieves bounded, sanitized public HTTPS page text and metadata with source URLs. Both appear in tool receipts and are subject to budgets, cancellation, Stop, redaction, and failure learning.

Private/loopback/link-local destinations, unsafe schemes, credential-bearing URLs, DNS rebinding, malicious redirects, and unbounded downloads fail closed. Page instructions are untrusted content, not authority.

## Current limitations

Browser and web availability depend on packaged runtime closure, profile readiness, domain policy, and provider configuration. Tests do not perform authenticated or production writes. Cross-device tool execution still requires an enrolled available worker and compatible target policy.

## Privacy and data handling

Tool output is minimized before it reaches a provider or timeline. Browser secrets, local environment secrets, and raw unbounded output must not be logged, backed up, synced, or relayed. Existing-profile mode is a convenience choice with a larger visible privacy surface than isolated mode.
