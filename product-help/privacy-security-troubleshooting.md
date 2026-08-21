# Privacy, security, deletion, and troubleshooting

Waypoint is local-first and workspace-scoped. A provider or tool receives only what the selected route and policy explicitly allow. UI and AI can share ordinary domain commands, but security-critical settings, secret entry, enrollment, and external permission boundaries remain user-controlled.

## Security boundaries

- Workspaces isolate chats, documents, memory, attachments, tools, receipts, sync, and deletion.
- Provider keys use OS-protected storage and are excluded from UI readback, logs, backup, sync, and relay.
- Tool and browser output is bounded and redacted. Page text, documents, Help pages, tool output, and webhook payloads are untrusted data rather than instructions or authority.
- Global Stop and per-run cancellation stop supported active work; terminal status must remain truthful after success, failure, cancellation, timeout, or restart.

## Deletion

Hard deletion is source- and ownership-aware. Deleting a source cascades to owned derivatives where the product states that relationship. Independent copies—for example an image already sent to Chat or a file saved outside Waypoint—must be deleted separately. Sync tombstones prevent older peers from recreating deleted records.

Before deleting a workspace, chat, document, meeting, capture, or device relationship, read the displayed scope. Waypoint should not require a database reset to recover from a normal feature error.

## Common readiness problems

### A provider says unavailable or disabled

Open **Settings → Models**. For Codex or Claude, check that the installed CLI is supported and signed in. Waypoint searches the sparse Finder/Explorer application path plus reviewed user-local install locations, so a normal `~/.local/bin` Codex install is discoverable without starting a login shell. Compatibility is still version-gated: Waypoint currently validates the Codex app-server protocol in stable CLI 0.146.0 and 0.149.0, and displays other versions rather than starting them silently. For OpenRouter, confirm a protected key is stored, the provider and live requests are explicitly enabled, a curated model is selected, and cost caps have remaining budget. Entering a key alone does not make paid requests.

### An attachment or document will not process

Confirm the file type and size are supported and the active workspace/chat did not change while it was being added. A corrupt or excessively decoded image fails closed. PDF/DOCX/TXT/Markdown chat delivery and Knowledge imports use local extraction. OpenRouter image chat also requires a verified Images model in **Settings → Models**; Kimi K3 and Qwen 3.8 Max are the current curated image choices. An unavailable embedding provider degrades to non-semantic search rather than deleting the source.

### Voice, meetings, or capture is not ready

Open the relevant Settings section and review OS permission, device, shortcut conflict, packaged runtime/model integrity, and bounded media limits. Waypoint never bypasses macOS/Windows consent. Settings reports when an ad-hoc macOS build has a version-specific code identity and can open Screen Recording Settings directly; an older enabled Waypoint entry does not authorize a newly identified build. Stable permission continuity requires an authorized Apple signing identity and controlled key custody. Waypoint does not install a broad local signing certificate; production distribution still requires authorized Developer ID signing and notarization. A black/invalid screenshot or undecodable audio should produce an actionable failure rather than a false success.

### Sync or cross-device work is offline

Check the chosen transport, host/relay status, device enrollment/revocation, fingerprint, key epoch, and target worker policy. A sleeping desktop host cannot provide direct-host service. Physical Windows/Mac and two-device validation limits should remain visible.

## Help accuracy

Waypoint retrieves a bounded set of hashed bundled Help pages for likely app questions and asks the selected model to cite them. If the answer is absent, outdated, or contradicted by a live readiness state, the assistant must say so and direct the user to the relevant Settings/status surface. Live status wins over general documentation.

## Current limitations

Bundled Help explains reviewed product behavior but is not a live diagnostic probe. Installed CLI versions, OS permissions, device reachability, provider caps, packaged runtime health, external authorization, and hardware-contingent validation can change after a page is built. For those questions, use Help together with the current Settings/status surface. Help cannot repair a failed runtime, grant permission, recover a deleted independent copy, or activate an external account.

## Privacy and data handling

Help retrieval is local and uses only the current question for ranking. It does not search personal chats, Knowledge, client workspaces, secrets, or attachments. The selected provider receives the bounded Help excerpts only when the prompt is a likely Waypoint product question.
