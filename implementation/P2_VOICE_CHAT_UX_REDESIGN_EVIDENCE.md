# P2 voice-chat UX redesign evidence

## Implementation

- Replaced the inline configuration surface with one animated three-bar composer control and a small transient status chip.
- Added schema 25 workspace/device-local voice preferences for push-to-talk/hands-free, microphone ID and reviewed system output.
- Moved readiness, mode, device, output, privacy, diagnostics and Stop into Settings.
- Added local speech/silence turn boundary logic; raw samples remain solely in the bounded ephemeral capture buffer and are not persisted.
- Added press/release race handling, pointer capture, keyboard symmetry, cancellation generation checks and reduced-motion styling.

## Verification

- Focused repair gate: 16 tests passed. Full terminal gate: 94 files / 433 tests, lint, production build and dependency audit (zero known vulnerabilities) passed.
- Native macOS arm64 directory package and bundled runtime/framework/model closure passed.
- A packaged isolated copy of normal chat data was visually inspected without copying secrets or using the microphone. The conversation shows one right-sized waveform control beside attachment/provider controls and no inline configuration panel; normal and maximized layout remain full-width and focused.
- Independent review initially found preference restoration, scope-retargeting, pending-permission and terminal-cleanup highs. Repairs load schema-25 preferences, bind immutable workspace/chat targets before permission, invalidate every scope transition, and clear state/session/ref/status on every early and late failure.
- Final independent verdict: **0 blocker / 0 high / 0 medium — clean**. Actual microphone permission/use remains the explicit user-consented packaged test.
