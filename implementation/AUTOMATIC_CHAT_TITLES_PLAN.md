# Automatic chat titles — focused phase

## Acceptance gate

- After the first meaningful user/assistant exchange, start one bounded background title attempt without delaying the response.
- Send only a short redacted user-topic envelope: never attachments, assistant/tool output, URLs, credentials, or workspace context.
- Prefer only the installed Claude Code lightweight alias that its own help advertises (`fable` here); otherwise use explicitly activated, cap-safe OpenRouter `openai/gpt-4.1-nano`; always retain deterministic local fallback.
- Persist and sync title provenance; preserve manual rename permanently; recover interrupted attempts; cancel on chat/workspace deletion, global stop, and shutdown.
- Show the updated title in history/header, an unobtrusive pending state, accessible manual rename, and minimized lane/outcome activity.
- Pass focused lifecycle/provider/privacy/migration tests, full tests/lint/type/build, packaged runtime closure, normal-profile macOS inspection, and independent review with no unresolved blocker/high.

Windows-native package behavior remains platform-contingent.
