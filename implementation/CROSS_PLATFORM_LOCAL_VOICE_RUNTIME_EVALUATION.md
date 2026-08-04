# Cross-platform local voice runtime evaluation

Status: research gate only. No runtime/model was downloaded, integrated, or approved for redistribution by this artifact.

## Decision

Pocket TTS through sherpa-onnx is the leading candidate for the next consented benchmark, replacing generic sherpa TTS models as the primary quality/latency path. It is not yet the production default. Waypoint keeps the current native macOS TTS repair behind the swappable adapter until the same packaged runtime passes macOS arm64 and Windows x64 gates.

## Evidence-based ranking

1. **Pocket TTS via sherpa-onnx — benchmark first.** Kyutai's official repository describes a 100M-parameter CPU model, streaming audio, about 200 ms to first chunk, greater than 6x realtime on an M4 MacBook Air using two CPU cores, and long-text operation. It explicitly names sherpa-onnx as a Windows/macOS implementation with JavaScript and other bindings. Sherpa's official documentation has a PocketTTS configuration, a Node package for macOS arm64/x64 and Windows x64, and native TTS/VAD/ASR surfaces. Remaining gates are exact model/voice licenses and redistribution notices, Electron native-addon/package closure (including macOS shared-library resolution), real callback/chunk streaming rather than file completion, hard cancellation, and measured Windows 16 GB behavior.
2. **Qwen3-TTS — promising secondary lab candidate.** The official project provides 0.6B/1.7B models and streaming generation. Its Python/vLLM-oriented reference path does not by itself prove a common Electron-native Mac/Windows package, bounded CPU memory, redistributable model bundle, or the target latency. Do not infer those properties.
3. **Chatterbox — quality/voice-cloning alternative, not latency lead.** Its ecosystem offers capable local voices, but current chunked streaming generates whole chunks and community evidence reports multi-second first utterances and boundary artifacts. It must beat the same latency gate before reconsideration.
4. **Moshi — experimental full-duplex lane only.** Natural overlap/backchannels are attractive, but it remains separate from Codex/Claude reasoning and must pass substantially heavier licensing, package, memory, and cross-platform gates.
5. **Original rhasspy Piper — not a new default.** The original repository is archived. A maintained successor could be evaluated independently, but Waypoint will not anchor production architecture to the archived project.

CrisperWhisper remains limited to optional high-fidelity post-meeting transcription and is not part of live voice.

## Required benchmark gate

Run only after explicit approval to obtain the exact runtime/model artifacts. Use pinned hashes, license/notice inventory, and consented synthetic fixtures.

- First audible audio: median at or below 300 ms preferred; p95 below 1,000 ms on M4 Mac and the Windows 16 GB target.
- Hard cancellation: playback stops within 150 ms; speech-to-stop barge-in p95 below 250 ms; no queued/stale audio follows.
- Long replies: ordered streaming at 500, 2,000, and 10,000 characters with bounded queue memory and intelligible boundaries.
- Packaging: one adapter contract; signed/notarizable Electron arm64 macOS and x64 Windows package closure; no Docker, Python, compiler, environment-variable, or user-PATH prerequisite.
- Resources: record cold/warm startup, realtime factor, peak RSS/CPU, installed/model size, and idle footprint. A Windows 16 GB machine must remain usable during simultaneous STT, routing, and TTS.
- Privacy/lifecycle: offline after installation, no telemetry/cloud fallback/raw audio persistence, explicit model provenance/removal/update/rollback, backup exclusion, and hard deletion compatibility.
- Capability: streaming callback semantics, sample format, VAD/echo behavior, device loss, cancellation, accessibility, and truthful unavailable state.

## Sources inspected (2026-08-04)

- Kyutai Pocket TTS official repository: https://github.com/kyutai-labs/pocket-tts
- sherpa-onnx PocketTTS and JavaScript installation docs: https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html and https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html
- Qwen3-TTS official repository: https://github.com/QwenLM/Qwen3-TTS
- Chatterbox official repository: https://github.com/resemble-ai/chatterbox
- Moshi official repository: https://github.com/kyutai-labs/moshi
- Archived original Piper repository: https://github.com/rhasspy/piper
