# P2 local voice engines — Phase A evidence

Completed 2026-08-04.

- Added a Settings-only Fast Local / Experimental Full-Duplex selector without changing the single composer waveform control or session gestures.
- Schema 26 preserves existing mode/device/output settings, defaults existing workspaces to Fast Local, and keeps device-specific engine/diagnostic state outside workspace backup and sync.
- Trusted-main pack lifecycle uses versioned manifests, exact role/inventory and ownership checks, bounded sizes/counts, HTTPS provenance, platform/architecture and digest verification, canonical root containment, symlink rejection, install concurrency lock, digest-bound resumable staging, explicit fixture state, atomic promotion, rollback, recovery, and removal.
- Integrity-valid fixtures never make an engine selectable. Production readiness additionally requires complete production roles and a real injected runtime probe. Experimental remains disabled and no download begins automatically.
- Deterministic fixture diagnostics expose labeled first-audio, interruption, and turn-end values; malformed/unsorted/non-finite inputs and post-cancel audio fail closed.
- Verification: lint; 96 test files / 446 tests; production build; macOS arm64 directory package; packaged runtime closure; dependency audit with 0 vulnerabilities.
- Independent review: initial 4 high / 2 medium; first re-review 1 high / 1 medium; final clean (0 blocker/high/medium). The final low timestamp-validation note was also repaired before the full gate.

Phase A does not claim either new model runtime is installed. Fast Local still identifies the existing bundled Whisper/macOS compatibility path while Phase B remains gated on the cross-platform runtime/model/default-voice bundle. Experimental fixture mechanics are present but cannot be selected until a real MiniCPM/llama.cpp-omni pack and runtime probe pass.
