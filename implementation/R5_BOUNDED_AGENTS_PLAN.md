# R5 Slice 2 — bounded local child tasks

## Acceptance gate

- Delegation is an explicit user action and uses a versioned typed task (`analyze`, `summarize`, `critique`) with a non-empty instruction capped at 4,000 characters.
- Exactly one child may follow a surviving depth-zero execution. Depth is capped at one; recursive or duplicate delegation fails closed.
- Child provider, local device, workspace, chat, and exact security profile equal the parent. No attachments, secrets, tools, connectors, fallback, peer execution, network expansion, or external authority.
- Runtime is capped at 60 seconds and never exceeds the profile cap; concurrency remains one and output remains under the existing 8 MiB ceiling.
- Typed lineage is durably reconstructable with content-minimized provenance. Parent cancellation propagates to an active child.
- Workspace isolation, chat deletion cascade, backup/restore recovery, deterministic terminal state, full verification, package/native launch, and independent review pass.

