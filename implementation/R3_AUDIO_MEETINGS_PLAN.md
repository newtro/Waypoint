# R3 Slice 5 — local audio-only meetings

## Conservative privacy decisions

- Recording starts only after a per-session checkbox confirming participants were informed and consented, then an explicit Start action and the operating-system microphone grant. Waypoint cannot determine legal consent and says so.
- A persistent red recording state, elapsed time, and Stop control remain visible. Capture is audio-only, capped at two hours and 100 MiB, and fails closed on malformed media or disk pressure.
- Audio, transcript drafts, and derived memory remain local-only and are not synchronized, uploaded, sent to a CLI, or passed to an external account. Retention is until explicit deletion; size and status are visible.
- Automatic transcription is capability-gated. The installed Whisper probe stalled and no reviewed cached/packaged model exists, so this slice does not invoke it or download a model. The UI truthfully offers a bounded editable transcript draft and labels speaker identity uncertain.
- A transcript must be explicitly marked reviewed before it can become source-owned knowledge. Deleting the meeting removes audio, transcript, relationship, search entry, and source-owned memory.

## Acceptance criteria

1. Consent reminder, OS permission denial, visible recording state, stop, device loss/interruption, two-hour/100-MiB limits, disk pressure, and malformed media have truthful failure behavior.
2. Completed local audio persists across reopen, displays size, plays locally, and exports through an explicit user-selected destination.
3. Transcript drafts are bounded to 500,000 characters, speaker handling is visibly uncertain, review is explicit, and knowledge creation is impossible before review.
4. Audio/transcript/derived memory are workspace-isolated. Meeting deletion physically removes local media and all source-owned derived state without copying content into activity.
5. Workspace backup/restore includes integrity-checked bounded meeting audio and remapped transcript provenance. No sync mutation or external transfer is created.
6. macOS package declares microphone purpose and grants renderer media permission only to the trusted Waypoint document for audio-only requests.
7. Focused privacy/lifecycle/migration/backup tests, full tests, lint, build, production audit, package/runtime closure, native launch, and independent adversarial review pass with no unresolved blocker/high finding.

## Deferred authority gates

- Selecting, packaging, licensing, updating, benchmarking, and running an automatic local transcription model.
- Meeting sync, peer transcription, speaker diarization claims, background capture, external transcription, account ingestion, scheduling, notifications, and distribution/signing.
- Windows microphone/media validation and two-running-instance/two-physical-device validation.
