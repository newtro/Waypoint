# Voice chat and meetings

Voice chat is an explicit, local-first way to feed speech into the normal chat pipeline and hear the text response. Meeting capture is a separate audio-only workflow with its own consent and review lifecycle.

## Voice chat

Use the compact waveform control in the composer. Voice configuration stays in **Settings → Voice**.

- **Hands-free** starts only after a click and remains active until the same control or global Stop ends it.
- **Push-to-talk** records only while the control or supported keyboard input is held.
- The transient state reports listening, transcribing, thinking, speaking, or an actionable error.

Fast Local is the supported engine. It bundles reviewed local speech-to-text and speech output assets, requires no terminal setup, and sends the final transcript through the selected normal chat provider. Raw live microphone audio is ephemeral and is not persisted by default. Barge-in stops queued speech and suppresses stale turn audio.

## Permissions and devices

macOS or Windows microphone permission is required before actual capture. Waypoint must explain permission state and never begin unattended recording. Input/output device choices are device-local settings. Automated verification uses synthetic fixtures; the user controls real microphone tests.

## Meetings

Meeting recording is explicit-consent, audio-only, local, and visibly active. A recording can be played back, exported, deleted, or given a manually reviewed transcript. The bundled Fast Local English transcription path can create an **unreviewed draft** for bounded recordings. It does not identify speakers and does not claim diarization.

Generated memories or commitments retain source provenance and require the normal review/lifecycle rules. Deleting an owned meeting source cascades to source-owned derived material according to the displayed confirmation.

## Current limitations

Fast Local is turn-based, not true full-duplex human conversation. Commercial real-time voice services and experimental MiniCPM replacement decisions are deferred. CrisperWhisper remains a meeting-only evaluation candidate. Automatic local transcription is bounded to supported media/duration; longer or unsupported recordings keep the manual transcript path.

## Privacy and data handling

There is no cloud speech fallback. Waypoint does not silently download a voice model, keep raw live-mic audio, or start a recording in the background. A configured hosted text provider can receive the final transcript only through the same explicit chat routing policy as typed text.
