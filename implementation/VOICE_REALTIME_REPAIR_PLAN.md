# Voice realtime repair gate

Scope: repair the current packaged macOS voice experience without adopting a new runtime or downloading a model.

Acceptance criteria:

- A long completed assistant reply starts native speech from a bounded first segment rather than submitting the entire reply to one `say` process. Segments remain ordered and intelligible.
- Hands-free playback runs an ephemeral speech-start monitor. Sustained user speech hard-stops the active process and all queued speech, then returns the same workspace/chat/session to listening. Noise, late completion, cancellation, failure, chat switching, and global stop cannot submit into a stale chat.
- The monitor retains no audio. Existing STT capture remains ephemeral; no cloud speech or download is introduced.
- Focused tests cover segmentation/order, queue cancellation/stale events, and speech-start detection. Lint, full tests, build, macOS arm64 package closure, packaged launch, and a no-microphone visual/runtime inspection pass.
- A fresh independent reviewer reports explicit severities; all blocker/high findings are repaired and reverified.

The native `say` segmentation is an interim compatibility repair, not the final cross-platform voice-runtime decision. The swappable voice interfaces remain authoritative.
