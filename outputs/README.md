# Waypoint planning documents

Waypoint is a cross-platform, personal-first “second brain” desktop application. These documents define the product direction and MVP without beginning implementation.

## Canonical documents

- [MVP plan](./MVP_PLAN.md) — target user, release promise, scope, acceptance criteria, and milestones.
- [Product architecture](./PRODUCT_ARCHITECTURE.md) — system boundaries, data ownership, sync topology, AI execution, security, and deletion semantics.
- [Delivery roadmap](./ROADMAP.md) — phased delivery order, dependencies, and release gates.
- [Decision log](./DECISION_LOG.md) — settled decisions, assumptions, deferred choices, and questions requiring validation.

## Planning rules

1. Desktop comes first; macOS and Windows are peer clients.
2. User data boundaries remain user-controlled.
3. The user-hosted Ubuntu/AWS node coordinates sync; it is not the unquestioned owner of the user's data.
4. Codex and Claude Code run through their signed-in CLIs, not ordinary model APIs.
5. Durable user content must have explicit lifecycle rules, including true cascade deletion.
6. Advanced capabilities enter the roadmap only after the core capture, retrieval, chat, and sync loop is trustworthy.

## Current status

Product discovery has been converted into an MVP plan. No implementation has started. Items marked “open” in the decision log should be resolved through prototypes, threat modeling, or user testing before their dependent milestone is committed.
