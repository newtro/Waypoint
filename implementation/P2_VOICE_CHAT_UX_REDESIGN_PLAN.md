# P2 voice-chat UX redesign

## Acceptance gate

- Conversation contains one compact, accessible waveform control beside attachment/send controls and no voice configuration panel.
- Workspace/device-local Settings persist default mode, microphone and output choice and show readiness, diagnostics, privacy and truthful turn-based limitations.
- Hands-free is click-to-enter/click-to-exit, uses local speech/silence boundaries per turn and resumes after local TTS; Stop cancels capture, generation and playback without stale audio.
- Push-to-talk records only between pointer/keyboard press and release; early release, cancel, repeated keys and permission/device failures cannot create a hands-free or orphan capture.
- Listening/transcribing/thinking/speaking status is compact, transient, live-region accessible and reduced-motion aware. Recovery points to Settings only when needed.
- Bundled local Whisper, system TTS, ephemeral cleanup, provider routing and recently completed provider controls remain unchanged.
- Migration/default/persistence, state boundaries, full tests/lint/build/audit, arm64 package/runtime closure, normal/isolated visual inspection and independent severity-rated review pass with no blocker/high.

Real microphone consent remains the user's explicit packaged-app test. Automated interaction uses synthetic state/audio fixtures only.
