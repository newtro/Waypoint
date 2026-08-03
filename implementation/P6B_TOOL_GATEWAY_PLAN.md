# P6B — Generic Tool Gateway vertical slice

## Gate and scope

Build the first production-quality local Tool Gateway slice in the trusted Electron main process. It serves future hosted/non-native model adapters and a small UI fallback through one machine-readable command contract. Codex and Claude Code retain their native coding/tool loops; this slice exposes only a thin Waypoint-domain bridge to them later.

Implemented capabilities:

- bounded `workspace.list_files` and `workspace.read_file` under a configured workspace root;
- bounded **interactive user-origin** `terminal.run` using the user's normal local shell environment, with explicit working directory, configurable deny patterns, output/time limits, process-tree cancel, and workspace/global stop;
- interactive user-origin `local_cli.run` for discovered `git`, `gh`, and Azure CLI executables using existing local authentication; no credential capture or duplicate OAuth/PAT storage;
- a domain-only trusted-main `AiWaypointControlBridge` and shared UI/AI Waypoint commands for workspace summary, chat creation, and memory creation;
- durable content-minimized receipts/activity with capability/version, origin, workspace/device/profile/policy digest, status, timings, resource bounds, redacted command summary, denial/failure code, and rollback reference where meaningful;
- visible settings/status/receipt fallback surface.
- a live in-chat Codex/Claude execution timeline derived only from structured CLI events already available: tool/action start, safe progress/result summary, terminal status, cancellation, ordering, durable reconnect, and restart reconciliation. Missing provider-internal events are labeled as unavailable and never invented.

Typed but unavailable seams: browser profiles, OpenRouter/Kimi/DeepSeek adapters, cross-device leases, Azure DevOps-specific semantics, PR operations, deployments, external webhooks/accounts, and security-setting mutation. They must report unavailable/explicit-authority-required rather than simulate success.

## Security policy

- Only the existing trusted `Autonomous developer` profile is eligible. Filesystem paths must remain under a canonical configured root; symlink/path escapes fail closed.
- Terminal access remains unrestricted for an explicit interactive user-origin request except user-managed deny regexes and task suppressions. AI-origin terminal and local-CLI requests fail closed in this slice: lexical filtering cannot guarantee that a hostile model will not exfiltrate inherited environment or Keychain credentials. Enabling those calls for a hosted model requires a later OS-enforced no-exfiltration boundary or an explicit policy revision. The gateway never returns or persists the child environment; returned output and commands are fully assembled then redacted before receipts or renderer results, while live progress exposes byte counts only.
- `git commit` and `git push` are allowed with a visible notification unless suppressed by task policy. PR create/update, deployment-shaped commands, credential/keychain/env-dump commands, and external account/permission setup are blocked in this slice even if a model requests them.
- Every request is workspace-scoped, schema validated, finite, cancellable, concurrency limited, and dominated by a workspace/global stop. AI input never widens policy.
- Security-critical settings, roots, environment policy, profile authority, secrets, credentials, external tenants/accounts, webhook endpoint ownership, and destructive security lifecycle are user-only and absent from the AI command catalog.

## Acceptance criteria

1. Versioned JSON tool descriptors and receipts are deterministic and bounded. UI and AI origins call the same dispatcher and receive the same validation/status semantics.
2. Main-process enforcement rejects unknown tool discriminants, cross-workspace IDs, root/path escapes including symlinks, malformed/excessive arguments, unavailable CLIs, denied patterns, secret-dump/PR/deploy commands, stopped workspaces, concurrency overflow, AI inherited-process execution, and AI security-setting mutation.
3. Interactive terminal/CLI execution supports bounded byte-count progress, timeout, cancel, global stop, truthful spawn/exit/failure state, normal local environment inheritance without environment disclosure, and POSIX process-group termination with SIGKILL escalation. Windows process-tree termination remains platform-contingent.
4. Redaction covers secret-shaped environment assignments, common token/key/password flags and values, bearer/basic material, private-key blocks, URL credentials, and configured secret names in requests, output, errors, receipts, and activity metadata.
5. Durable receipts cascade with workspace deletion, preserve only minimized metadata, and appear in a UI fallback with live status, stop/cancel, deny-list editing, capability discovery, and explicit unavailable seams.
6. Focused tests cover policy boundaries, redaction, cancellation/stop, workspace isolation, path/symlink escape, CLI discovery/failure, deny list, output/time/concurrency bounds, UI/AI parity, migration, backup/restore, and deletion.
7. Full tests, lint, build, dependency audit/SBOM, native macOS package/runtime closure and launch pass. Windows remains platform-contingent.
8. Codex/Claude native runs display persisted ordered structured tool events and terminal states in chat with bounded redacted summaries; the visibility layer does not change their tool loop or expose prompts/secrets.

Executor: primary implementation task. Reviewer: fresh independent adversarial context given this plan and the exact diff. Terminal condition: no unresolved blocker/high finding and all required verification is green.
