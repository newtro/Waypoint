# Voice realtime repair evidence

Completed 2026-08-04.

- Root cause: macOS `say` received an entire response as one process input, and hands-free capture was closed throughout playback.
- Repair: ordered speech/sentence segmentation (260-character bound), one active native process at a time, immediate queue destruction on stop, and one-shot terminal settlement. Speaking is armed before IPC to close fast-completion races.
- Barge-in: an echo-cancelled/noise-suppressed ephemeral monitor retains only a bounded 250 ms pre-roll, dispatches native stop before teardown, continues the same stream through local VAD, and submits only after exact workspace/chat/turn checks. Stop, scope change, failure, and completion wipe the buffer; raw audio remains unpersisted.
- Focused verification: 3 files / 18 tests passed, covering true multi-segment drain/order, one-shot errors, stale cancellation, speech boundary, same-stream utterance handoff, pre-ack terminal ordering, IPC-first stop, and scope cleanup.
- Full gate: lint passed; 94 test files / 438 tests passed; production build passed; macOS arm64 directory package completed; packaged runtime and bundled STT closure passed; dependency audit reported 0 vulnerabilities. The unsigned local package limitation remains unchanged pending a release signing identity.
- Native inspection: packaged app launched successfully with an isolated local profile and rendered the onboarding window without runtime/path errors. No real microphone capture was initiated.
- Independent review: initial verdict 3 high / 2 medium; first re-review 1 high / 1 medium; final re-review clean (0 blocker, 0 high, 0 medium). All findings were repaired and reverified.

Residual user gate: a consented microphone/speaker test on the packaged app is still required to measure the room/device-specific acoustic echo and barge-in behavior. This is not claimed by fixture tests.
