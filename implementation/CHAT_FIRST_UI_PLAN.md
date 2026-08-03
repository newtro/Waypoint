# Chat-first UI rework gate

## Scope

Replace the dashboard-like shell with a full-height desktop AI chat experience: persistent left navigation and conversation history, a full-width central transcript, one grounded composer, and an invoked right-side knowledge/settings surface. Preserve durable chat, attachment truth, workspace isolation, local-only execution, and hard deletion.

## Acceptance gate

1. New Chat, selection, date-grouped/searchable/sortable history, continuation, deletion, and keyboard shortcuts are discoverable in the left navigation.
2. Transcript and composer use the available central pane at normal and maximized widths without nested scrolling or fixed-height dead space.
3. Knowledge is secondary and invoked; saved assistant responses are traceable, editable, and deletable without returning manual content-entry controls to the landing experience.
4. Drawers and responsive navigation provide dialog semantics, trapped focus, Escape close, and focus restoration.
5. The packaged macOS app preserves its last usable display, normal bounds, and maximized state; missing displays and off-screen bounds fall back visibly.
6. Tests, lint, build, dependency audit, package runtime closure, native launch, normal/maximized screenshots, and independent review/repair pass. Windows remains platform-contingent.
