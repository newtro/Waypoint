# P2 Voice Chat Mode — terminal evidence

Date: 2026-08-03

## Outcome

The bounded local-first voice-chat slice passed its Build-to-Complete gate. Waypoint now provides an explicit in-chat turn-based voice session with truthful readiness and state, user-selected local whisper.cpp-compatible runtime/model import, ephemeral microphone capture, normal chat/provider submission, local macOS speech, interruption, exact run cancellation, activity provenance, and global-stop integration. No model was downloaded and no cloud speech service or live microphone was used during verification.

## Verification

- Focused repaired gate: 6 suites / 17 tests, lint, and production build.
- Full gate: 84 suites / 382 tests; dependency audit found 0 vulnerabilities; dependency/license report contained 0 undeclared licenses; native macOS arm64 directory package and packaged runtime closure passed; diff hygiene passed.
- Automated coverage includes permission/device/capture bounds, partial/final transcript flow, raw-audio non-persistence, ephemeral cleanup, runtime probing/path safety, workspace/deletion/backup/sync lifecycle, exact assistant-message speech provenance, Claude completed-stream reconstruction, cancellation/global stop, late hosted/fallback run cancellation, and TTS replacement.
- Packaged UI was inspected with an isolated local profile. Actual microphone permission and transcription remain an explicit user test after the user installs/selects a reviewed local runtime and model.

## Independent review

Initial verdict was NO-SHIP (0 blocker / 5 high / 4 medium). Repair rounds addressed transcription/global-stop cancellation, minimized errors, crash residue, exact run/message correlation, stale speech, runtime/device truthfulness, and regression coverage. A late review found one high in just-returned OpenRouter cancellation and one medium in cross-workspace speech replacement; both were repaired and regression-tested.

Final verdict: **SHIP — 0 blocker / 0 high / 0 medium / 0 low**.

## Honest residual gates

- Waypoint does not ship or silently download a whisper.cpp runtime/model. STT remains unavailable until the user explicitly selects compatible local files.
- Live microphone permission, chosen hardware, and real local-model performance require user-consented testing.
- Windows TTS/package/hardware validation, streaming partial STT/VAD, Kokoro, Moshi/full duplex, filler acknowledgments, and CrisperWhisper meeting transcription remain separate phases.
