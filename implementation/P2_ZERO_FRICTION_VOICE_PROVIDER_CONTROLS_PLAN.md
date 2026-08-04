# P2 zero-friction voice and provider controls

## Scope and gate

Ship a macOS arm64 offline STT default and repair provider/model controls without making a cloud call, using credentials, or changing normal user data during verification.

Acceptance requires:

- A fresh packaged app automatically finds a pinned, redistributable whisper.cpp runtime and English model; there is no normal-path file picker, download, cloud STT, Docker dependency, or raw-audio persistence.
- Package closure verifies the runtime, framework, model, architecture, executability, and exact digests. A consent-free synthetic fixture transcribes through packaged resources.
- Voice retains explicit microphone permission, stop/barge-in/cancel, ephemeral audio cleanup, normal text-chat persistence, truthful unsupported-platform state, and local macOS TTS.
- Composer models are accessible selects. Codex choices come from the installed CLI catalog; Claude exposes only its verified CLI default because its installed CLI provides no account-scoped catalog without a live request. Unknown saved values remain visible legacy/custom values.
- OpenRouter retains the curated catalog. A protected stored key is recognized and one explicit activation control enables both hosted-request gates, with selected models and existing caps, without a health or paid request.
- Focused tests, full tests, lint/build/audit, package/native proof, isolated-state contracts, normal-data read-only diagnosis, independent severity-rated review, repairs, and final re-verification have no unresolved blocker/high.

Windows bundled speech remains platform-contingent. Signing/notarization remains release-identity gated.
