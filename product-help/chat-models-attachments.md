# Chat, models, and attachments

Waypoint routes normal chat through the user’s installed, signed-in Codex CLI, Claude Code CLI, or Grok Build CLI. OpenRouter is an optional hosted route that remains unavailable until the user stores a protected key, explicitly enables live requests, and stays within configured spending policy.

## Choosing a provider and model

Use the provider and curated model selectors in the composer or **Settings → Models**. Settings and composer use the same persisted preferences. Unknown historic model values remain visible as legacy/custom values rather than being silently replaced.

- **Codex**, **Claude**, and **Grok Build** use their signed-in local CLI subscriptions and expose truthful availability from installed CLI capability probes. Grok readiness additionally requires a compatible installed CLI and a model inventory that proves the active `grok.com` login.
- **OpenRouter** uses protected OS secret storage, explicit activation, cost caps, warnings, and subscription fallback. It never validates or spends against a key merely because the key was entered.
- If a selected route is unavailable, Waypoint explains why. Fallback never widens tool or account authority.

## Repository and authority

Use **Settings → Agent workspace** to choose the repository or working folder an agent may use. Waypoint keeps chats, notes, recordings, and indexes in separate private app storage. Changing or clearing the repository invalidates provider-session bindings and is blocked while agent work is active.

The composer’s authority selector is explicit: **Chat · read only** can inspect without modifying files, **Developer · approve changes** gives structured file tools selected-root authority and asks before changes and commands, and **Full agent · network enabled** adds network-capable provider tools while retaining approval prompts. On Windows, Claude/Codex/Grok shell and PowerShell commands are host authority when their provider runtime cannot prove OS sandbox containment: Developer and Full Agent require approval for each command, while Bypass has no prompts. Structured path-bearing tools remain selected-root-scoped. The selected root remains the working directory and durable session binding, not an OS boundary for Windows shell commands. A provider session is bound to the chat, provider, repository root, profile, and model. It is never a credential and can be reset from Settings.

The chat header and execution timeline show streaming, completion, cancellation, failure, provider, model, and redacted tool events when the underlying CLI supplies them. Provider-authored assistant text stays in the conversation while the structured tool/reasoning trace is collapsed separately. Useful partial assistant text remains visible if a run is canceled or fails.

Waypoint does not set an AI completion-token, generated-output, file-creation, or wall-clock limit. Interactive, delegated, remote, and webhook-triggered Codex/Claude/Grok runs use the installed provider runtime until it completes or the user explicitly cancels it; OpenRouter requests likewise omit a Waypoint completion-token cap. Provider-owned context/service limits, explicit protected spending controls, repository authority, approvals, and redacted/truncated UI audit presentation still apply.

## Attachments

The composer accepts supported images, PDF, DOCX, TXT, and Markdown files. Images appear as bounded thumbnails and open through the protected viewer. Attachment chips can be removed before sending.

Provider capability matters:

- **Images:** Codex receives validated image paths through its app-server protocol. Claude receives validated pixels through the Agent SDK’s structured image input. The current Grok ACP capability does not advertise image input, so Grok images remain local and the UI says so. OpenRouter receives base64 image content only through the explicit curated **Images** model selected in Settings. The current verified OpenRouter image choices are Kimi K3 and Qwen 3.8 Max.
- **Agent tools:** Codex, Claude, and Grok retain their provider-native session, skill, plugin, MCP, and tool behavior inside the selected repository and authority profile during normal chat. OpenRouter uses Waypoint’s Tool Gateway for repository, terminal, controlled web/browser, and Waypoint domain tools. Mutating or external OpenRouter calls require a visible Waypoint decision and every call produces a local receipt. Large command output may be truncated in the visible receipt, but an approved command or workspace-file write is not killed or rejected solely because of elapsed time, stdout size, or file size.
- **Documents:** Codex, Claude, and Grok receive a run-scoped, integrity-checked local file path inside the selected repository so their installed CLI can handle the document with provider-native capabilities and limits. Waypoint removes that temporary copy after the run. OpenRouter uses local extraction because it has no local filesystem access. The execution timeline records the source name and digest prefix without storing attachment bytes in the receipt.
- **OpenRouter routing:** GLM 5.2 and DeepSeek V4 Flash are currently text-only choices. When a chat includes pixels, Waypoint uses the separately selected Images model and records the actual model and cost. It never guesses that a text-only model can see an image.

Imported documents can be added to Knowledge for local extraction, provenance-bearing chunking, and search. Attaching a file to a chat does not automatically make it a Knowledge document.

Local chat storage does not impose a Waypoint AI file-size or attachment-count limit. Cross-device encrypted attachment transport currently supports files through 25 MiB, the first 20 eligible attachments for one owning chat item, and 500 eligible attachments per workspace. Files outside those transport bounds remain available locally and to the selected local CLI, are labeled **stored locally only** on their attachment chip, and are counted in Settings rather than being silently presented as synchronized.

## Automatic titles

After the first meaningful exchange, Waypoint may attempt a tool-free title using an available approved lightweight lane. If provider lanes are unavailable, explicitly canceled, spending-blocked, or fail, it uses a deterministic title from the first user message. Deleting or manually renaming the chat wins over a late title result.

## Current limitations

CLI model availability depends on the installed CLI version and current sign-in. OpenRouter health is not claimed until it is configured and used. Hosted image usage can cost money and remains subject to the same explicit activation and caps. A scanned PDF with no extractable text is not silently sent to hosted OCR; attach page images or use a separately authorized OCR path. OpenRouter local extraction retains bounded resource protection; local Codex, Claude, and Grok document delivery does not add that extraction limit. Windows CLI/process behavior must be validated on Windows.

## Privacy and data handling

Prompts and attachment bytes stay within the selected route and current security policy. Codex, Claude, and Grok document bytes stay local to the user-installed CLI. OpenRouter receives locally extracted document text rather than invoking a hosted parser. Images are transmitted only after the user sends the attachment through an eligible route. Secrets, raw environment values, protected paths, base64 payloads, and Keychain contents must not appear in chat receipts. Help retrieval uses only the user’s question and bundled product pages; it does not search other chats or workspaces.
