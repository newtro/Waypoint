# Screen Capture Add-to-Chat repair gate

Status: approved focused repair.

Acceptance criteria:

- Add a captured or flattened screenshot directly to the selected chat without a persistent success notice.
- Render accessible, bounded, aspect-preserving thumbnails for captured and pasted images in the composer and durable transcript; open a protected full-image viewer.
- Preserve workspace/chat ownership, provenance, restart persistence, deletion, backup/sync lifecycle, and retry idempotency without stale-context leaks or orphan files.
- Reject corrupt, oversized, decompression-heavy, cross-workspace, deleted, or stale results before they can be shown as success.
- Preserve pulled Windows guided/quick capture work and repair any migration-induced preference change.
- Pass focused and full tests, zero-warning lint, build, packaged runtime closure, normal-profile app inspection, and an independent severity-rated review with no unresolved blocker/high finding.
