# Chat, models, and attachments

Waypoint routes normal chat through the user’s installed, signed-in Codex CLI or Claude Code CLI. OpenRouter is an optional hosted route that remains unavailable until the user stores a protected key, explicitly enables live requests, and stays within configured spending policy.

## Choosing a provider and model

Use the provider and curated model selectors in the composer or **Settings → Models**. Settings and composer use the same persisted preferences. Unknown historic model values remain visible as legacy/custom values rather than being silently replaced.

- **Codex** and **Claude** use their signed-in local CLI subscriptions and expose truthful availability from installed CLI capability probes.
- **OpenRouter** uses protected OS secret storage, explicit activation, cost caps, warnings, and subscription fallback. It never validates or spends against a key merely because the key was entered.
- If a selected route is unavailable, Waypoint explains why. Fallback never widens tool or account authority.

The chat header and execution timeline show streaming, completion, cancellation, failure, provider, model, and bounded redacted tool events when the underlying CLI supplies them. A final assistant reply is the lowest item for a completed turn.

## Attachments

The composer accepts supported images, PDF, DOCX, TXT, and Markdown files. Images appear as bounded thumbnails and open through the protected viewer. Attachment chips can be removed before sending.

Provider capability matters:

- Codex can receive supported image paths plus bounded text extracted locally.
- Claude currently receives bounded text in this Waypoint adapter; unsupported binary/image delivery is reported honestly.
- OpenRouter chat attachments are currently disabled, so files remain local rather than being silently uploaded.

Imported documents can be added to Knowledge for local extraction, provenance-bearing chunking, and search. Attaching a file to a chat does not automatically make it a Knowledge document.

## Automatic titles

After the first meaningful exchange, Waypoint may attempt a bounded, tool-free title using an available approved lightweight lane. If provider lanes are unavailable, canceled, capped, or fail, it uses a deterministic title from the first user message. Deleting or manually renaming the chat wins over a late title result.

## Current limitations

CLI model availability depends on the installed CLI version and current sign-in. OpenRouter health is not claimed until it is configured and used. Hosted usage can cost money. Windows CLI/process behavior must be validated on Windows.

## Privacy and data handling

Prompts and attachment bytes stay within the selected route and current security policy. Secrets, raw environment values, and Keychain contents must not appear in chat receipts. Help retrieval uses only the user’s question and bundled product pages; it does not search other chats or workspaces.
