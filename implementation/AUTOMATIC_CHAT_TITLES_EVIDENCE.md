# Automatic chat titles — evidence

## Delivered behavior

- Schema 32 adds durable `placeholder`, `automatic`, and `manual` title provenance plus recoverable attempt state.
- The renderer starts naming only after a meaningful user and assistant exchange, polls without delaying the chat response, updates the sidebar/header, and provides an accessible manual rename control.
- The provider envelope contains only a bounded, redacted first-user topic. The assistant response, attachments, tool output, URLs, code blocks, and secret-shaped values are excluded.
- Routing is Claude Code `fable` only when advertised by installed CLI help, then activated/cap-safe OpenRouter `openai/gpt-4.1-nano`, then deterministic local fallback. OpenRouter validation used fixtures only; no paid validation request was made.
- Attempts are idempotent and cancel on manual rename, deletion, global stop, and shutdown. Shutdown awaits tracked work before closing storage. Manual titles reject late automatic completion and automatic sync cannot overwrite a local manual title.

## Verification

- Focused: 38 tests passed across title privacy/routing, Stop policy, store lifecycle, and ordered migration; TypeScript passed.
- Full: 114 files / 501 tests passed; ESLint had no errors (nine pre-existing hook warnings); renderer and main-process builds passed.
- macOS arm64 package built; packaged runtime/resource closure passed.
- Normal-profile packaged inspection showed `Naming chat…` without blocking chat, followed by immediate sidebar/header replacement with `Workspace Provider Tools and Voice Status`. The minimized activity receipt recorded `claude`, model `fable`, and selected-lane reason. No microphone, external account, or paid API was used.
- Initial package inspection briefly hit a stale-process error after overwriting the running bundle; a clean quit/relaunch loaded normally and did not reproduce it.

Independent review initially found two High privacy/shutdown issues and two Medium sync/observability issues. Re-review found two further High edge cases around uncommon secret forms and Stop-triggered retry. All findings were repaired. Final independent verdict: 0 Blocker / 0 High.
