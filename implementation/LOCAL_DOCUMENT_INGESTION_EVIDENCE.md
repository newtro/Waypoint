# Production local document ingestion — evidence

Status: passed 2026-08-03.

## Outcome

- Imports user-selected PDF, DOCX, UTF-8 TXT, and Markdown through a memory/time-bounded worker. PDF.js and Mammoth are pinned production dependencies; no Python, Docker, cloud parser, OCR, macro execution, or implicit download is used.
- Persists canonical extracted text, the owned source attachment, and a durable source binding containing revision, source/text digests, and extractor provenance. Derived chunks carry exact offsets/digests plus policy/provider/model generation provenance.
- Local Ollama/Qwen indexing is optional and bounded by one active job per document and a five-minute whole-job deadline. Batch model digests must remain identical. Unavailable, busy, failed, and edited-source states are distinct and truthful.
- Reindex is atomic, retains two complete generations, supports rollback, rejects post-import edits against the old source, and preserves the prior generation on failure. Backup/restore carries and revalidates the canonical source binding while derived vectors remain explicitly rebuildable.
- The chat-first Knowledge surface exposes import, status, source, provider/model, chunk count, reindex, and rollback. Chonkie remains a first-class benchmark candidate only; it is not installed, integrated, or presented as available.

## Verification

- Full suite: 69 files / 313 tests passed.
- Lint and TypeScript/Vite production build passed.
- Compiled extraction-worker proof passed; the worker inside the packaged app ASAR extracted a real Markdown fixture.
- Production dependency audit: zero vulnerabilities and zero undeclared licenses; CycloneDX SBOM generation passed.
- Native arm64 macOS directory package, packaged runtime closure, and isolated-profile native launch passed. Windows packaging/extraction remains platform-contingent.
- Independent review began at blocker 0 / high 4 / medium 3 / low 1. Repairs bounded indexing, prevented mixed model generations, made errors truthful, added durable source provenance, hardened worker output validation, and closed backup restore/drill integrity. Final verdict: ship, blocker 0 / high 0 / medium 1 / low 1.

## Residual non-blocking items

- Medium: hostile encrypted/malformed PDF/DOCX, extreme page/text/chunk limits, forced worker termination, and injected mixed-digest/abort Ollama paths need deeper direct tests beyond the implementation guards and current package/full-suite evidence.
- Low: the additive source-provenance table remains within archive format 3; older strict format-3 readers may reject such archives. Make compatibility explicit in the next archive-format revision.
