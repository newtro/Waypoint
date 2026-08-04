# P2 Voice Chat Mode — acceptance gate

Date: 2026-08-03

## Bounded slice

1. Voice starts only from a visible in-chat user action. State is continuously exposed as off, listening, transcribing, thinking, speaking, or error; stop is always available and dominates capture, transcription, generation, and playback.
2. The renderer explains microphone permission, lists user-selectable audio-input devices, supports push-to-talk and explicitly started hands-free turns, and exposes keyboard/screen-reader labels. Permission denial, device loss, and unavailable local STT are truthful.
3. A swappable STT contract accepts bounded ephemeral PCM/WAV only. The first production adapter uses a user-selected whisper.cpp-compatible executable and model; Waypoint validates but never downloads or installs them. Fixture STT is test-only and labeled.
4. Final transcript text enters the existing selected chat/provider path. Partials are ephemeral. Raw live audio is never stored in SQLite, backup, sync, activity, logs, or relay. Final messages keep existing workspace, deletion, backup, sync, routing, cancellation, receipt, and provenance behavior.
5. A swappable TTS contract uses native macOS `say` for the initial supported path. Barge-in or stop terminates playback and cancels/suppresses the active model turn so stale text cannot be spoken. Other platforms report unavailable until reviewed.
6. Activity records are content-minimized state/outcome receipts only. Global Tool Gateway stop disables/halts voice; voice never changes provider authority or silently activates OpenRouter spending.

## Verification

- Deterministic state-machine tests cover invalid transitions, permission/runtime/device errors, partial/final transcript lifecycle, generation cancellation, barge-in, stale playback suppression, and global stop.
- Runtime tests cover missing/untrusted binary/model, bounded audio, timeout/cancel, cleanup, malformed output, and no raw-audio persistence.
- Integration tests prove final text uses ordinary chat storage/lifecycle and activity receipts contain no transcript/audio.
- Full tests, lint/build, dependency audit, native macOS package/runtime closure, and packaged visual/readiness inspection.
- Independent adversarial review must report no unresolved blocker/high before commit/push.

## Explicit exclusions

No cloud speech API, model download, unattended/background recording, meeting recorder changes, Moshi/full duplex/backchannels, CrisperWhisper, Kokoro install, Windows claim, external service, deployment, or release.
