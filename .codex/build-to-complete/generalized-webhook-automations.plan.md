# Generalized Webhook Automations

## Goal

Let Waypoint safely receive real provider webhooks and let chat propose, confirm, provision, and run webhook-triggered AI automations without hard-coding one provider or event family.

## Authority boundaries

- No external provider mutation occurs before an explicit, durable user approval bound to the exact proposal digest.
- Provider credentials remain in the provider CLI or operating-system credential store; Waypoint never asks the model to reveal them.
- Inbound events are authenticated, normalized, deduplicated, quarantined, and matched to an enabled rule before any AI job starts.
- AI jobs use an explicitly approved provider, model, security profile, workspace, limits, and action.
- Desktop-host webhook endpoints are advertised as local-network/self-signed only. Cloud-provider hooks require a publicly reachable trusted relay or an explicitly configured tunnel.
- Platform-specific provisioning and discovery remain adapter-scoped; macOS/Linux paths are preserved.

## Phase 1 - Generalized secure ingress

- Support signed generic senders on hosted relay and active desktop host.
- Define provider-neutral connector/event contracts and native-provider authentication adapters.
- Normalize GitHub, Azure DevOps, Stripe, Resend, and generic events into one durable envelope.
- Automatically fetch, decrypt, validate, deduplicate, quarantine, and notify the renderer.
- Show truthful endpoint reachability and certificate/trust state.

## Phase 2 - Durable proposals and ask-user confirmation

- Persist automation proposals, exact digests, questions, decisions, and approval receipts.
- Add first-class AI tools to draft a proposal and ask the user to confirm or reject it.
- Render a non-blocking confirmation card in chat; navigation must not interrupt the running chat.
- Invalidate approval if any security-relevant proposal field changes.

## Phase 3 - Connector provisioning

- Add a connector registry with discovery, validation, preview, apply, and rollback guidance.
- Implement Azure DevOps via installed `az devops invoke` and GitHub via installed `gh` where available.
- Support Stripe and Resend through secret-safe guided/API configuration contracts, with truthful unavailable states when credentials or public ingress are missing.
- Always show the exact external mutation and require approval before execution.

## Phase 4 - Triggered AI execution and Automations UI

- Match normalized events to enabled rules using explicit event and filter constraints.
- Start a bounded AI job using the approved provider/model/security profile and record provenance, status, retries, cancellation, and failure.
- Polish Automations in the main content area for endpoints, connector health, proposals, rules, runs, kill switch, and cleanup.

## Phase 5 - Verification and delivery

- Run migrations, focused unit/integration tests, lint, typecheck/build, package runtime closure, and a packaged Windows pass.
- Exercise a real signed webhook and a real confirmation lifecycle.
- Exercise Azure DevOps provisioning only when authenticated organization/project/repository context and a public trusted endpoint are available; otherwise prove preview and report the exact unavailable gate.
- Complete independent phase and whole-project adversarial reviews, fix serious findings, commit, and push `main`.
