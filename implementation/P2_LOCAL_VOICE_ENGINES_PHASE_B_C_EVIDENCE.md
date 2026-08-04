# P2 Local Voice Engines — Phase B/C evidence

Date: 2026-08-04

## Acceptance outcome

- Fast Local is the default, fully bundled path: `sherpa-onnx-node` 1.13.4 with OpenAI Whisper tiny.en int8 ONNX STT and Kitten Nano English v0.1 fp16 TTS. The same asset/runtime contract is packaged for macOS and Windows; the user installs no Python, CLI, model, path, or post-install download.
- The compact composer waveform control and Hands-free / Push-to-talk gestures are unchanged. Engine, readiness, voice mode, device, output, privacy, and diagnostics remain in Settings.
- Synthesis runs in one-shot, least-environment child processes and uses bounded sentence/segment early playback (not token/audio-frame streaming). A stop/barge-in kills that process and the renderer's Web Audio queue; stale scope/turn chunks are rejected. Transcription uses the same isolated-worker boundary. No raw microphone or synthesized audio is persisted.
- Experimental Full-Duplex remains a shipped managed-pack capability behind the Phase A manifest/integrity/resume/atomic-activation machinery. It is visibly experimental and cannot be selected until an exact MiniCPM-o 4.5 / llama.cpp-omni production manifest and runtime probe pass. No large pack was downloaded and no terminal/manual-path setup is offered.

## Asset and license decision

- Pocket TTS was rejected for bundling. Its official sherpa archive says “non-commercial,” while the included file is CC BY 4.0, and the bundled default reference-voice redistribution provenance was not sufficiently clear. Waypoint does not resolve that conflict in its own favor.
- Kokoro's official sherpa archive passed the Apache-2.0 asset gate but measured roughly 1.14 seconds to first callback on this M4 target, above the one-second production gate.
- Kitten Nano's official sherpa archive contains an Apache-2.0 license covering its model and voice table. Archive SHA-256: `f35dac93754fe2ac97c66e1f468311d0d2130f7f0f5a89bfa1197e09a0cbdec5`. The package preparation script pins and verifies the model, voice, token, and license hashes before every package.
- The cross-platform STT bundle uses the official sherpa Whisper tiny.en export archive (`2bd6cf965c8bb3e068ef9fa2191387ee63a9dfa2a4e37582a8109641c20005dd`) and pinned int8 encoder/decoder/token hashes. OpenAI's upstream Whisper code and weights are MIT licensed; the included notice is pinned from the upstream repository.

## Verification

- Repeatable production-worker gate: first playable audio 649 ms, two ordered segments, complete response; cancellation terminated the isolated worker after its first segment with no later segment (`cancelWallMs` 1,095 ms including startup and first generation).
- Packaged Electron/arm64 native closure: model/runtime/license hashes pass, the packaged sherpa native addon loads, and an exact packaged generation fixture completed in 744 ms to first playable audio at 24 kHz.
- The common STT worker initialized and transcribed the official local sherpa fixture in 353 ms with the expected text. Windows x64 static closure includes the same STT/TTS assets and the pinned `sherpa-onnx-win-x64` dependency; the actual Windows run remains platform-contingent.
- Full gate: ESLint; 99 test files / 455 tests; TypeScript/Vite production build; macOS arm64 directory package; packaged runtime/Whisper/Fast Local closure including real model initialization and a sub-one-second synthesis gate; npm audit with zero vulnerabilities.
- Packaged UI was launched in an isolated profile and visually inspected at 1180 × 760. The existing chat-first layout and single composer control remain unchanged. No microphone was used.

## Deferred truthfully

- Windows x64 package/run/audio-device validation remains platform-contingent even though npm selects the pinned Windows native sherpa package and the playback path is Web Audio.
- Actual acoustic microphone permission, echo, speaker-to-mic barge-in, and interruption-to-silence require the user's consented device test.
- The exact Experimental Full-Duplex download size, hardware gate, model license, and first-run cost cannot be claimed until its production pack manifest is approved. The app performs no silent or manual external installation.

## Independent whole-program review

- Final verdict across committed Phase A and the Phase B/C implementation: **PASS / SHIP — 0 blocker, 0 high, 0 medium, 2 low**.
- The reviewer confirmed the single composer control, Settings-only configuration, fail-closed experimental pack lifecycle, common isolated sherpa STT/TTS workers, bounded ephemeral audio, scope/turn stale-event defenses, hard cancellation, provider routing, and package/license/provenance closure.
- Accepted low findings: the obsolete macOS whisper.cpp compatibility runtime remains packaged but is not on the live path; measured engine diagnostics reset after restart to clearly labeled fixture values rather than being persisted. Neither changes runtime truthfulness or the release gate.
