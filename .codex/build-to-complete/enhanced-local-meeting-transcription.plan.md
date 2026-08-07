# Enhanced Local Meeting Transcription

Repository: `D:\Repos\Waypoint`

## Objective

Replace Waypoint's low-quality, speaker-blind meeting draft with a materially better fully local workflow while preserving the original recording, the existing fast/manual fallback, explicit consent boundaries, cross-platform packaging, and truthful capability states.

## Technical decision

CrisperWhisper 2.0 is not bundled: its model weights are non-commercial and require a commercial license. Waypoint will instead use the already-shipped Apache-2.0 sherpa-onnx runtime with redistributable OpenAI Whisper and MIT pyannote segmentation weights plus a redistributable speaker-embedding model. The design keeps the ASR/diarization engine behind an internal contract so a licensed CrisperWhisper provider can be added later without changing meeting storage or UI.

## Phase 1 - Transcript contract and deterministic composition

### Outcome

Define validated timestamped speaker-turn data and deterministic formatting/renaming helpers. Preserve plain-text transcript compatibility and never infer real speaker identity.

### Non-goals

No model execution or UI changes in this phase.

### Integration path

Audio engine result -> validated speaker turns -> readable draft text -> existing reviewed transcript/knowledge workflow.

### Acceptance

- Reject malformed, overlapping, unbounded, or oversized engine output.
- Format stable `[HH:MM:SS] Speaker N` blocks and merge safe adjacent turns.
- Rename speaker labels without changing spoken text or timestamps.
- Focused unit tests pass.

## Phase 2 - Cross-platform enhanced local engine

### Outcome

Add an isolated worker and process adapter that decode a complete recording, diarize speakers, transcribe turns with a stronger Whisper model, report progress, honor cancellation, and fall back to the existing fast local/manual path when enhanced assets are unavailable.

### Non-goals

No cloud transcription, microphone capture changes, voice identity recognition, or restricted CrisperWhisper weights.

### Integration path

Meeting IPC -> bounded FFmpeg decode -> isolated sherpa-onnx worker -> structured transcript contract -> atomic store update.

### Acceptance

- Fixed-input process launch; no shell interpolation or network use at transcription time.
- Asset manifests and hashes are verified before packaging and by packaged-runtime closure checks.
- Maximum two-hour input and bounded output/worker lifetime; cancellation leaves previous transcript unchanged.
- Capability differentiates enhanced, fast fallback, and unavailable states truthfully.
- Windows execution passes; macOS branches and resources pass static build/package verification.

## Phase 3 - Speaker-aware meeting UI and persistence

### Outcome

Expose enhanced/fast engine choice, timestamped speaker labels, speaker renaming, progress, review status, and provenance in the Meetings content area without interrupting active chats.

### Non-goals

No automatic real-name identification and no automatic promotion of draft text to knowledge.

### Integration path

Renderer Meetings tab -> preload IPC -> main engine -> store -> renderer refresh -> explicit review -> existing knowledge save.

### Acceptance

- Enhanced Local is the recommended default when ready; Fast Local remains selectable.
- UI states that speaker labels are estimates and audio stays on-device.
- User can rename `Speaker 1` style labels and edit transcript text before review.
- Restart preserves draft transcript and engine provenance.
- Renderer tests/types/build and visual runtime inspection pass.

## Phase 4 - Real recording, full gates, and adversarial completion review

### Outcome

Validate locally against the preserved real recording without copying it into the repository, run the complete automated/package gates, and fix evidence-backed review findings.

### Acceptance

- Original and safety-backup hashes remain unchanged.
- Real recording yields non-empty timestamped, multi-speaker output or a truthful documented limitation.
- Full tests, build, lint, package runtime closure, and `git diff --check` pass.
- Each phase receives a fresh read-only adversarial review.
- Two fresh independent whole-project reviewers return clean or all valid BLOCKER/MAJOR findings are fixed and re-reviewed.

