# Provider Attachment Parity — Build to Complete

## User outcome

Images and supported documents can be sent from the same chat composer through Codex, Claude, or OpenRouter without a provider-specific dead end. Waypoint remains truthful about the underlying model: image pixels go only to a proven image-capable model, while PDF, DOCX, TXT, and Markdown are extracted locally and delivered as bounded text with source provenance.

## Fixed decisions

- Codex receives validated image paths through its documented `--image` input.
- Claude receives validated image bytes through its installed CLI's structured `stream-json` image input. No filesystem tool is enabled and no Anthropic API key is introduced.
- OpenRouter receives base64 image content only through a curated image-capable model. Kimi K3 and Qwen 3.8 Max are the currently verified curated image routes; GLM 5.2 and DeepSeek V4 Flash remain truthful text-only choices.
- OpenRouter has a separate curated **Images** model setting so an everyday text model does not silently receive an incompatible request. Existing activation, caps, protected key, and explicit hosted-request policy remain authoritative.
- PDF and DOCX are never sent to OpenRouter's parser by default. Waypoint uses its reviewed local PDF.js/Mammoth extraction for every provider, avoiding hidden hosted OCR/parser charges. TXT/Markdown use strict local UTF-8 extraction.
- Attachment content is data, never instruction or authority. No attachment enables tools, expands workspace scope, or bypasses provider/cost policy.

## Acceptance gate

1. A validated PNG/JPEG/GIF/WebP reaches Codex and Claude as real image input; a real bounded local Claude completion proves the installed structured path.
2. OpenRouter fixture transport emits correct multimodal message content without a live paid request, uses the explicit curated image model, and rejects unknown/text-only image routes before network access.
3. PDF, DOCX, TXT, and Markdown are extracted locally off the main thread for all three routes, carry filename/media type/source digest/extractor provenance, and respect aggregate prompt/resource limits.
4. Corrupt, oversized, cross-workspace, deleted, unsupported, or extraction-failed attachments fail closed with actionable status. Cancellation and terminal failure do not retain attachment bytes outside normal attachment storage.
5. Receipts/timeline show bounded attachment names, delivery mode, digest prefix, and actual provider/model without storing bytes, base64, protected paths, secrets, or raw unbounded content.
6. OpenRouter cap fallback passes the original attachments to the approved subscription route; it never widens provider/tool/account authority.
7. Settings and composer messaging are synchronized: no stale “OpenRouter attachments disabled” path, image-capable model choices are curated, and text-only model limitations are visible.
8. Existing attachment persistence, thumbnails, backup/restore, sync, hard deletion, workspace isolation, key protection, and no-warning policy remain clean.
9. Focused tests, full tests, `eslint --max-warnings 0`, build, package/runtime closure, and normal-profile packaged Mac inspection pass.
10. A fresh independent severity-rated review reports no unresolved blocker/high findings after repairs.

## Explicit limitations

- A text-only underlying model cannot be made natively multimodal. Waypoint provides product parity by selecting the user's explicit image-capable route within the same configured provider and recording the actual model.
- Scanned PDFs without an extractable text layer are not silently sent to paid hosted OCR. They fail with guidance to attach page images or use a separately authorized OCR path.
- No live OpenRouter request is part of verification; final live health remains user-triggered and cost-controlled.
- Windows native/package validation remains platform-contingent.
