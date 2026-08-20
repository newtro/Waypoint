# Model-Directed Configuration Tools

## Intent

Waypoint models choose tools from the user's request. A user must not need to enable a composer mode before Codex, Claude, Grok, or OpenRouter can infer that a recurring request needs webhook/automation configuration. The selected security profile continues to govern ordinary file, shell, network, MCP, browser, and provider-native authority. Persistent automation provisioning remains an exact, auditable Waypoint transaction.

## Phase 1 — Always-available model-selected configuration

### Outcomes

1. Remove the **Automate** composer toggle and the `automationPlanning` renderer/IPC contract.
2. Advertise the Waypoint automation proposal tool on every direct root chat turn for Codex, Claude, Grok, and OpenRouter.
3. Let each provider retain the selected profile's normal tools and authority while deciding whether the request needs the automation tool.
4. Use semantic tool descriptions and trusted prompt context, not keyword routing. One-off PR work stays one-off; recurring/triggered requests can invoke the automation proposal tool; ambiguity can use the provider question path.
5. Keep the proposal tool itself bounded: it validates a definition and creates at most one pending confirmation transaction per turn. It never directly provisions or enables a hook.
6. Preserve existing provider-session continuity safely. Sessions that cannot carry the always-available tool must start a fresh tool-capable provider session with prior Waypoint conversation context bridged forward.
7. Preserve exact provider/profile/root/secret-redaction/cancellation boundaries, slash-skill behavior, cross-platform code paths, and the rule that no Waypoint token/output/file-size/wall-clock cap is added.
8. Update product help and visible composer copy so the behavior is discoverable and truthful.

### Non-goals

- Do not auto-create external accounts, credentials, webhooks, or automation rules merely because a model mentions them.
- Do not use keyword heuristics to select tools.
- Do not broaden a security profile's ordinary shell, filesystem, network, MCP, browser, or external-provider authority.
- Do not let delegated child tasks independently create persistent automation proposals without a direct root chat request.
- Do not redesign the existing proposal approval/provisioning/reconciliation workflow.

### Integration path

Composer send -> chat IPC -> trusted model tool context -> provider-native/dedicated tool catalog -> model-selected proposal call -> shared proposal validation and receiver planning -> one pending confirmation card -> existing approval/provisioning/reconciliation path.

### Automated proof

- Focused provider, main-composition, renderer, IPC, OpenRouter Tool Gateway, migration/session, product-help, and automation proposal tests.
- Full test suite, TypeScript/Vite build, lint, product-help verification, and `git diff --check`.
- Package-runtime closure and Windows package build after source is clean.

### Runtime proof

- Real signed-in direct-chat probes for installed Codex, Claude, and Grok showing tool availability without a composer toggle, ordinary authority retained, and no proposal for a one-off PR request.
- Real signed-in recurring PR request prepares exactly one pending proposal without directly provisioning it.
- OpenRouter path is verified with the real hosted tool contract when configured; otherwise use a protocol-level integration proof and report the external gate truthfully.

### Visual/manual proof

- Inspect the rebuilt Windows UI: no Automate toggle; composer truthfully explains model-selected tools; provider/profile/model controls remain usable.
- Final Program Files installation requires action-time UAC confirmation before installation.

### Decisions and external inputs

- No product decision is outstanding. The user explicitly selected model-directed tool choice with normal profile authority.
- UAC approval is required only for the final installed-copy checkpoint.
