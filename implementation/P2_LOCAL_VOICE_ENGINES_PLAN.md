# P2 selectable local voice engines

Status: approved; preparation gate complete; implementation in progress after realtime repair `9b9811c`.

## Immutable product contract

- The composer remains one compact waveform control. Hands-free click-to-enter/exit, push-to-talk hold/release, transient status, global stop, privacy, and workspace/device persistence are engine-neutral. No engine-specific chat controls.
- Settings contains one selector: **Fast Local** (production/default) and **Experimental Full-Duplex**. Diagnostics show readiness, exact component versions, package/voice-pack size, first-audio, interruption-to-silence, turn-end delay, and last bounded error.
- No Python, terminal, CLI, paths, manual model selection, Docker, cloud speech, raw-audio retention, or implicit download. Fast Local ships in each supported signed app. Experimental uses either a dedicated package or one explicit in-app install with progress, resume, pinned integrity, atomic activation, rollback, and removal.

## Phase A — engine-neutral contract and pack lifecycle

Acceptance:

- Versioned engine/pack manifests enumerate platform/architecture, components, sizes, digests, licenses/notices, minimum resources, capabilities, and conversation ownership.
- Trusted main-process probe fails closed on missing, extra, symlinked, wrong-version, wrong-platform, or digest-mismatched files. Pack installation is staging-first, size/concurrency bounded, resumable, atomically promoted, rollback-safe, and never accepts arbitrary executable paths.
- Workspace-local preference defaults to `fast_local`; experimental cannot be selected unless ready. Historic settings migrate without changing mode/device. Backup/sync exclude executable/model packs and metrics containing device paths.
- Deterministic fixture engines prove streaming chunks, metric collection, cancellation, stale-event suppression, and shared UI/session behavior.

## Phase B — Fast Local packaged runtime

Target: pinned sherpa-onnx Node/native runtime with a redistribution-safe default English voice and a common packaged Whisper STT model; Pocket TTS remains only a candidate until its exact model/default-voice redistribution terms are unambiguous. The completed gate selected Apache-2.0 Kitten Nano English v0.1 fp16 for TTS and the official MIT Whisper tiny.en int8 sherpa export for STT.

Acceptance:

- macOS arm64 fresh package contains every runtime/model/voice asset and notice; no network/PATH/environment prerequisite. Windows x64 uses the same contract and platform package, with execution validation contingent on Windows hardware.
- Audio is consumed as early PCM chunks, not whole files. Fixture p95 first audio is under 1 second (target 300 ms); hard cancel prevents all later chunks. Real packaged M4 benchmark records p50/p95 cold/warm TTFA, interruption, turn-end, CPU/RSS, and package size without claiming inaudible proxy timing.
- Provider text remains the normal Codex/Claude/OpenRouter route. Fast Local owns only VAD/STT/TTS/turn transport.
- Exact sherpa, ONNX Runtime, model, tokenizer, and voice licenses/provenance pass dependency/security review. A voice with ambiguous redistribution or consent provenance blocks shipping.

Current research evidence: sherpa-onnx/node 1.13.4 is Apache-2.0 and publishes macOS arm64/x64 and Windows x64 packages; the official Pocket int8 archive is approximately 98.3 MB compressed; Pocket TTS code/model is MIT and officially claims ~200 ms first chunk and >6x realtime on M4. These are upstream claims, not Waypoint results. Default voice licensing remains an asset-specific gate.

## Phase C — Experimental Full-Duplex managed voice pack

Target: MiniCPM-o 4.5 via pinned llama.cpp-omni. It owns its local conversational model and therefore does **not** claim Codex/Claude/OpenRouter tool/reasoning continuity during the full-duplex session.

Acceptance:

- Selector is disabled until a platform readiness probe passes. Settings truthfully displays model/runtime size, disk/RAM/GPU guidance, expected first-run cost, license, and provider limitation.
- No multi-GB asset is silently fetched. One explicit Install action uses Waypoint's managed manifest, pinned origin/digests, free-space check, resumable staging, progress/cancel, atomic activation, recovery, removal, and update rollback. Fixture archives prove mechanics before any real pack authority.
- Hard stop and interruption use the same session contract and metrics. Headphone guidance is visible because the official demo currently documents echo-cancellation limitations affecting interruption.
- macOS/Windows binaries must be reproducibly built/audited and packaged without Python. Windows performance remains platform-contingent. The 9B model and its audio/TTS components must pass real memory/latency gates before the option can be called ready.

## Gate order

Phase A review must be clean before real assets. Phase B must pass package/runtime/acoustic review before becoming the default. Phase C fixture pack mechanics may proceed without model download, but real pack activation requires a separately visible multi-GB download/package decision with exact measured size. Whole-program review covers identical UI behavior, privacy, deletion, stop/cancel, corrupt packs, downgrade/update, and truthful provider ownership.
