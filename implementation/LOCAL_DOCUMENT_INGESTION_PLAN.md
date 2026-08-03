# Production local document ingestion and chunking

Status: acceptance frozen 2026-08-03.

## Scope

Import a user-selected PDF, DOCX, UTF-8 TXT, or Markdown file into the current workspace as a durable document with its source attachment, locally extracted text, provenance-bearing chunks, lexical search, and optional live Ollama embeddings. Images remain truthful chat attachments; no OCR capability is claimed. No external account, cloud parser, Python runtime, model download, listener, schedule, trigger, or unattended action is authorized.

## Acceptance gate

- Validate extension/MIME/signature and existing 25 MiB attachment bounds before extraction. Extraction runs locally with pinned PDF.js and Mammoth dependencies and bounded pages, text, chunks, and time.
- Imported text becomes a durable document revision; the original file is a document-owned attachment. Every chunk records workspace/document/revision/attachment, exact character offsets and digest, deterministic policy/version/digest, and provider/model provenance when embedded.
- Built-in deterministic sentence-window chunking is the only production path in this phase. Chonkie (`chonkie-inc/chonkie`) is a first-class candidate behind the existing swappable chunk-policy/benchmark boundary, but is not integrated or selectable in the product yet. Its future gate must compare representative retrieval quality and provenance fidelity; macOS/Windows native packaging; Python/runtime, dependency, license, and security posture; latency/memory; and correct reindex, rollback, deletion, and backup behavior. Evaluation may not implicitly install Python, contact a cloud service, or download a model.
- Import succeeds lexically when Ollama/Qwen3-Embedding 4B is unavailable, with a visible truthful degraded state and explicit Reindex action. No fixture vector is represented as semantic production data.
- Reindex builds a complete new generation before switching, retains at most one prior complete generation for rollback, and never mixes provider/model/chunk-policy generations. Failed reindex preserves the prior generation.
- Source edit, attachment deletion, document deletion, workspace deletion, and restore preserve ownership: derived chunks/vectors are purged or explicitly absent/rebuildable; canonical extracted text and source attachment survive backup/restore.
- Search returns document identity plus the matching chunk excerpt without crossing workspace boundaries.
- Import/Reindex are explicit knowledge actions in the chat-first UI with status, provider/model, chunk count, source filename, and actionable failure text.
- Tests cover all four formats, malformed/encrypted/empty/oversized/bounded inputs, unavailable/malformed embedding provider, atomic failure, reindex/rollback, deletion/workspace isolation, backup/restore/rebuild, migration, package/runtime, and independent review.

## Next streams

After this clean gate, implement local proactive trigger rules and webhook simulation/configuration only. Public ingress, schedules, connectors, external data, outbound delivery, and unattended activation remain later explicit gates. First-class local voice interaction follows that trigger phase, with its own consent/runtime/deletion gate and no cloud voice API or implicit model downloads.
