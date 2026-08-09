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

- **Images:** Codex receives validated image paths through its CLI image input. Claude receives validated pixels through its installed CLI’s structured, tool-free image input. OpenRouter receives base64 image content only through the explicit curated **Images** model selected in Settings. The current verified OpenRouter image choices are Kimi K3 and Qwen 3.8 Max.
- **Documents:** PDF, DOCX, TXT, and Markdown use the same bounded local extraction path for Codex, Claude, and OpenRouter. The execution timeline records the source name, digest prefix, and extractor provenance without storing attachment bytes in the receipt.
- **OpenRouter routing:** GLM 5.2 and DeepSeek V4 Flash are currently text-only choices. When a chat includes pixels, Waypoint uses the separately selected Images model and records the actual model and cost. It never guesses that a text-only model can see an image.

Imported documents can be added to Knowledge for local extraction, provenance-bearing chunking, and search. Attaching a file to a chat does not automatically make it a Knowledge document.

## Automatic titles

After the first meaningful exchange, Waypoint may attempt a bounded, tool-free title using an available approved lightweight lane. If provider lanes are unavailable, canceled, capped, or fail, it uses a deterministic title from the first user message. Deleting or manually renaming the chat wins over a late title result.

## Current limitations

CLI model availability depends on the installed CLI version and current sign-in. OpenRouter health is not claimed until it is configured and used. Hosted image usage can cost money and remains subject to the same explicit activation and caps. A scanned PDF with no extractable text is not silently sent to hosted OCR; attach page images or use a separately authorized OCR path. Very large aggregate document context fails with guidance to send fewer or smaller sources. Windows CLI/process behavior must be validated on Windows.

## Privacy and data handling

Prompts and attachment bytes stay within the selected route and current security policy. PDF and DOCX bytes remain local because Waypoint sends their locally extracted text rather than invoking a hosted parser. Images are transmitted only after the user sends the attachment through an eligible route. Secrets, raw environment values, protected paths, base64 payloads, and Keychain contents must not appear in chat receipts. Help retrieval uses only the user’s question and bundled product pages; it does not search other chats or workspaces.
