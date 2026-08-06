# P9 — local Meeting Intelligence

## Acceptance gate

1. A completed consented recording can be transcribed with the already packaged Apache-2.0 Fast Local Whisper tiny.en runtime; no download, path, CLI, cloud API, account, or raw-audio upload is introduced.
2. Saved WebM/MP4 audio is decoded only in the trusted Waypoint renderer and downmixed into sequential two-minute, <=12 MiB PCM WAV segments. To keep renderer memory bounded without shipping a second media decoder, automatic transcription is truthfully limited to ten minutes / 25 MiB / 48 kHz stereo in this slice; longer recordings retain manual review. The main process binds the run to one ready meeting/workspace, enforces ordering and a five-segment ceiling, zeroes each segment, and atomically saves only the final text draft.
3. Cancel and global-stop paths abort the isolated transcription worker and leave the previous transcript unchanged. Failure never produces partial durable text. One run per workspace prevents overlap.
4. Generated text is explicitly `draft`; speaker diarization/identity is unavailable and never guessed. The user must edit and mark reviewed before knowledge creation. Existing deletion, backup/restore, workspace isolation, source-owned memory cascade, and manual fallback remain intact.
5. Meetings UI shows readiness, progress, cancel, and truthful provider/diarization boundaries. Package closure proves the shared Fast Local runtime/model remains present on macOS; Windows execution stays hardware-contingent.
6. Focused/full tests, lint/build/audit/package, native visual inspection, and independent severity-rated review have no unresolved blocker/high.

## Deferred, not dropped

- CrisperWhisper remains an optional post-meeting quality benchmark requiring exact model access/license approval and representative consented fixtures.
- Speaker diarization requires a separately reviewed local model/runtime. Microsoft calendar/Teams meeting context requires tenant registration/consent. No cloud transcription is authorized.
