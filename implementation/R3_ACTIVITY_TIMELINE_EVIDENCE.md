# R3 Slice 4 — unified activity timeline evidence

## Implemented boundary

- Normalized stable event families for content, AI execution, sync/device, rules, lifecycle, maintenance, and future meeting/automation producers.
- Bounded, workspace-scoped, newest-first timeline projection with family and safe-text filtering.
- Surviving-object resolution for chats, messages, notes, memories, commitments, rules, executions, and workspace events; missing/deleted targets remain non-navigable historical evidence.
- Strict display-metadata allowlist. Prompts, authored bodies, transcripts, attachment data, local paths, credentials, keys, raw execution output, and sync payloads never enter the renderer timeline projection.
- Chat-first Activity drawer adds accessible filter controls, explicit availability state, truthful future-family empty state, and contextual navigation.
- Schema 12 adds the workspace/time activity index without rewriting prior events.

## Gate evidence

- Initial independent verdict: blocker 0 / high 1 / medium 3 / low 0. The high showed that a failed local activity write between device revocation and key rotation could interrupt the security-critical rotation. Medium findings covered the 250/500 UI query boundary, target-specific navigation, and imported token-shaped secrets in allowlisted metadata.
- Repairs make post-success sync activity writes explicitly best-effort and complete revoke plus rotation before logging. The drawer loads the full bounded 500-event window; surviving execution/message targets resolve to chats and knowledge targets scroll/highlight precisely. Projection now accepts only closed enums, bounded integers, and validated local-day values; arbitrary model/status/phase/type/extractor strings are neither projected nor newly copied.
- Final independent verdict: blocker 0 / high 0 / medium 0 / low 0.
- Final comprehensive verification: 56 test suites / 259 tests, lint, production build, zero production audit vulnerabilities, native macOS directory package, packaged runtime closure, diff hygiene, and isolated-profile native launch.
- The package remains intentionally unsigned. Windows-native and two-physical-device/two-instance validation remain deferred by explicit user direction.
