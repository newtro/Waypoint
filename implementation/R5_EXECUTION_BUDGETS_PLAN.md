# R5 Slice 4 — conservative local execution budgets

## Scope

Make every existing local root or child execution carry an enforced, visible, durable least-authority budget. This slice grants no new provider, tool, network, secret, peer, fallback, cost, scheduling, or unattended authority.

## Acceptance gate

1. The trusted main process derives a versioned receipt from the actual security profile and root/child type; the renderer cannot submit budget authority.
2. Root limits: 2,000,000 prompt bytes, 8 MiB output, profile/120-second duration, concurrency one, depth one, one child, one attempt, up to 20 selected attachments.
3. Child limits: 512 KiB prompt, 2 MiB output, profile/60-second duration, concurrency one, no children, one attempt, zero attachments.
4. Both receipts fix local device, fallback off, external cost off, peer off, and a digest of the effective security profile.
5. Chat Send/Retry and Delegate are explicit action origins. There is no automatic retry, unattended continuation, or receipt reuse that widens authority.
6. Output termination, timeout, cancellation, interruption, child count, and attachment/prompt rejection remain deterministic and truthful.
7. Receipts are content-minimized, visible in Settings/recent executions, preserved by export/restore, workspace-scoped, and deleted with their chat execution.
8. Focused/full tests, lint, build, dependency review, macOS package/runtime/native launch, diff hygiene, and independent adversarial review pass with no unresolved blocker/high.

## Deferred user decisions

Fallback policy, unattended categories, approval cadence changes, cost/token budgets for API providers, writable tools, peer execution, recursive depth, and higher concurrency require explicit future policy decisions. Defaults remain off or one.
