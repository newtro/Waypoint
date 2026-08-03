# R3 Slice 4 — unified activity timeline

## Scope

Turn the existing append-oriented activity records into a workspace-scoped, useful, content-minimized timeline. This slice defines event-family contracts for content, execution, sync/device, rules, automation, meetings, lifecycle, and maintenance, but does not create automation, recording, connector, scheduling, or external authority.

## Acceptance criteria

1. The Activity surface is filterable by event family and safe display text, bounded, newest-first, keyboard accessible, and secondary to the chat-first interface.
2. Events link to surviving chats/messages, knowledge, rules, and executions where a safe destination exists. Deleted/missing targets remain truthful historical evidence without dead navigation.
3. Content, AI execution, sync/device, rule, deletion, maintenance, and reserved meeting/automation families share a stable normalized contract. Empty future families are not represented as active features.
4. Timeline output never duplicates prompt/message/document/memory/transcript bodies, attachment data, file paths, credentials, keys, raw CLI output, or opaque sync payloads. Display metadata is allowlisted.
5. Queries are workspace isolated and bounded to 500 inspected/returned records. Workspace hard deletion cascades timeline records; export/restore retains only the existing content-minimized history.
6. Schema migration adds the ordered workspace/time index, remains fail-closed, and preserves prior activity.
7. Focused lifecycle/privacy/filter/migration tests, full tests, lint, build, production audit, native macOS package/runtime closure and isolated-profile launch pass. Independent review has no unresolved blocker/high finding.

## Explicit exclusions

- No meeting capture, scheduler, playbook, webhook, connector, account access, external send, or work data.
- No Windows/signing/release claim and no two-instance or two-physical-device sync validation.
- No retrospective fabrication of events not already durably emitted.
