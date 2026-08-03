# R4 Slice 1 — local fixture connectors and automation dry runs

## Scope

Build the authority-free first R4 slice: a synthetic local connector contract and versioned playbook/schedule preview engine. This proves provenance, scope separation, deterministic dry runs, manual fixture execution, pause/kill behavior, idempotency, and audit without connecting an account, running a background scheduler, invoking a model, exposing a webhook, or performing an external action.

## Acceptance criteria

1. Connector manifests identify provider, account and tenant boundary, fixture status, declared scopes, and separate read/draft/write capabilities. Only the built-in synthetic fixture provider can be registered in this slice; tokens and network configuration are structurally absent.
2. Versioned workspace playbooks use a bounded declarative step set. External fixture content remains data and cannot add steps, scopes, tools, prompts, writes, sends, models, schedules, or security changes.
3. Schedule definitions retain IANA timezone and local wall-clock time, expose DST-aware next-occurrence preview, and remain paused. Enabling background/unattended execution fails with a truthful authorization-gate message.
4. Dry run returns deterministic input/output counts, permission snapshot, provenance, omissions, and proposed effects. Manual fixture execution requires the current dry-run digest, is idempotent, and cannot produce any effect beyond a local preview artifact.
5. Bounded retry/dead-letter records, pause/kill switch, and content-minimized activity exist. Raw synthetic bodies are not copied into activity or permission history.
6. Playbooks, runs, fixture provenance, and preview artifacts are workspace-isolated, exportable/restorable, and hard-delete with their workspace/playbook ownership. No sync mutation is produced in this local-only slice.
7. The chat-first UI exposes an unobtrusive Automations drawer labeled Fixture lab, with visible paused/local-only state, next-run preview, dry run, manual run, history, and kill switch.
8. Tests cover wrong workspace/tenant, scope escalation, prompt injection, duplicate/out-of-order fixtures, idempotency, invalid timezone/DST, missed preview, retry/dead letter, stale dry run, kill switch, deletion, backup/restore, migration, bounds, and privacy. Full test/lint/build/audit/package/native and independent review gates pass.

## Explicit gates

- No provider registration, OAuth/token, external account/tenant, work/client data, sandbox account, webhook endpoint, network call, schedule activation, notification, send/write, model access, or credential storage.
- Real Outlook/calendar/email/Teams/DevOps/webhook adapters and any background schedule require separate provider/user/employer authorization.
- Windows, signing/release, and two-instance/two-device validation remain deferred.
