# Provider Attachment Parity — Completion Evidence

## Delivered

- Codex receives validated PNG, JPEG, GIF, and WebP pixels through immutable run-scoped `--image` snapshots.
- Claude Code receives the same validated pixels as structured base64 image blocks through its installed signed-in CLI, with tools disabled.
- Explicitly enabled OpenRouter image turns use a separate curated image-capable route (Kimi K3 or Qwen 3.8 Max); no live paid request was made during verification.
- PDF, DOCX, TXT, and Markdown use the same bounded local extraction and provenance contract for all three providers.
- Settings, composer routing, receipts, backup/restore/sync schema, and bundled Waypoint Help describe the same truthful capability state.
- Provider fallback retains the selected Codex/Claude subscription model and never passes an OpenRouter model identifier to a local CLI.
- Attachment identity, chat ownership, and digest are revalidated after asynchronous preparation and immediately before hosted dispatch or local process spawn.

## Verification

- Focused provider/integrity gate: 5 files, 37 tests passed.
- Full gate: 138 files, 615 tests passed, 1 intentional skip.
- ESLint: `--max-warnings 0`, zero warnings.
- TypeScript application and preload builds: passed.
- Waypoint Help `2026.08.08.2` freshness/integrity: passed (8 pages).
- Production renderer build: passed.
- macOS arm64 directory package and packaged runtime/resource closure: passed.
- Normal-profile packaged inspection: provider image selector and composer image routing verified without a paid provider call.
- Bounded signed-in CLI proofs: Codex and Claude each completed a real image-understanding turn using the reviewed path.

## Independent review

The initial review reported three High findings: hosted-model leakage into subscription fallback, document-extraction digest TOCTOU, and mutable Codex image paths. Repairs bound fallback to the target subscription model, compare extraction against the validated digest, and use validated immutable image snapshots.

A second review found one High deletion race. The repair revalidates every source after preparation and at the final transport boundary. The final verdict is **Blocker 0 / High 0 / Medium 2 / Low 0**.

Tracked non-blocking hardening:

- Pre-run document extraction remains bounded but does not yet have a visible run identity/AbortSignal for cancellation during extraction.
- Normal terminal/error paths remove Codex snapshots; startup reconciliation after an abrupt process/OS crash remains a cleanup hardening item.

## Truthful external gates

- Live OpenRouter health/cost behavior remains user-triggered after protected key entry and explicit activation.
- Scanned PDFs without an extractable text layer require page images or a future separately reviewed local OCR path.
- Windows provider/process/package behavior remains a native Windows verification gate.
- Local development packaging is ad hoc signed because no valid Apple Developer ID is installed; release signing/notarization remains an external identity gate.
