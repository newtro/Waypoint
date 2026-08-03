# First-Class Chat evidence

Date: 2026-08-03

## Diagnosis and repairs

- Packaged Finder launches had a sparse `PATH`; Claude at `~/.local/bin/claude` and the Codex binary bundled with ChatGPT were invisible. Detection now checks bounded, fixed native install locations without evaluating shell profiles, and subprocesses receive the resolved executable directory first in their minimized `PATH`.
- Terminal execution finalization now retries transient SQLite writes and preserves streamed events in memory until the assistant message and terminal state are durably finalized. Persistent finalization failure is logged rather than presented as success.
- New Chat immediately creates and selects a durable empty chat. Sending creates one durable user message, moves its queued attachments to message ownership, starts the chosen CLI, streams normalized events, and persists the final assistant message.
- Failed, timed-out, and canceled runs offer retry from the latest durable user prompt and its attachments. Running jobs expose cancellation.
- Chat attachments use generated local object paths, SHA-256 integrity, `0700` storage directory and `0600` files, workspace/owner validation, export/restore provenance, rollback-safe deletion, and chat cascade deletion.
- Provider claims are deliberately narrow: Waypoint passes supported images to the Codex CLI through its real `--image` option and bounded text/Markdown through stdin; it passes bounded text/Markdown to the Claude CLI through stdin. This does not claim provider receipt or understanding. PDF/DOCX and unsupported media remain durable local sources with an explicit not-passed explanation.
- The chat shell uses the viewport height; history and message streams own their scroll regions and the composer remains usable. At the narrow desktop breakpoint the layout intentionally becomes a single scrolling column.

## Verification

- `npm test`: 31 files, 161 tests passed.
- `npm run lint`: passed.
- `npm run build`: production TypeScript and Vite build passed.
- `npm audit --audit-level=high`: zero vulnerabilities.
- `npm run diagnose:chat-runtime`: both CLIs discovered under a simulated packaged-GUI environment.
- `npm run verify:cli-live`: Codex and Claude each completed with `WAYPOINT_LIVE_OK`; forced failure and cancellation reached truthful terminal states; execution workspaces remained empty.
- `npm run package:dir`: native arm64 macOS package produced and launched. The package is intentionally unsigned locally; publication/signing was not authorized.
- Independent adversarial review found three high-severity issues (stale failure UI, inexact historical retry, and provider-receipt overclaim). All were repaired with refresh-on-failure, schema-6 source-message provenance, and passed-to-CLI wording. The focused re-review reran 161 tests, lint, build, audit, and diff checks and declared the blocker/high gate clean.

## Deferred/platform gates

- Windows package, launch, path discovery, filesystem permissions, process cancellation, and viewport checks remain mandatory on Windows hardware.
- PDF/DOCX semantic extraction is not implemented or claimed. Adding a parser requires a separate dependency/security/quality gate.
- Signing, notarization, publishing, and deployment remain unauthorized.
