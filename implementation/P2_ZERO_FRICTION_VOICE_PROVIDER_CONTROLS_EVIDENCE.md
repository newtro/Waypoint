# P2 zero-friction voice and provider controls evidence

## Implementation

- Bundled whisper.cpp 1.8.4 official macOS XCFramework, a minimal arm64 helper, and OpenAI Whisper `base.en q5_1` converted model as Electron extra resources.
- Pinned SHA-256 manifest and full MIT notices; no runtime/model download or speech network path.
- Runtime auto-discovery and fail-closed digest validation precede legacy custom fallback. Ephemeral bounded WAV handling, cleanup, cancellation, native TTS and no raw-audio persistence remain intact.
- Installed Codex `debug models` supplies visible selectable models. Claude exposes the installed CLI's default route only; no model availability is guessed.
- Composer freeform model entry is replaced by a provider-specific select; OpenRouter Settings and composer share the same persisted catalog/settings. Legacy/unknown selections remain visible.
- Protected-key activation uses one explicit paid-request control; normal user data was inspected read-only and showed a protected key with no `provider_settings` row, identifying the former disabled-state cause. No key bytes were read and no provider request was made.

## Verification

- Focused repair gate: 44 tests passed; bundled integrity/selection/version gating, cleanup, installed catalog filtering, schema-24 preference persistence/cascade, legacy preservation, protected-key activation and accessible synchronized selector contracts covered.
- Full: 93 files / 430 tests passed; ESLint and production TypeScript/Vite build passed.
- Dependency audit: zero known vulnerabilities at high threshold; 527 packages reported with no undeclared license.
- Package: Electron Builder produced `release/mac-arm64/Waypoint.app`; app.asar import closure, bundled voice hashes/executable permissions, framework symlink, rpath/dynamic load and minimum macOS 13.3 passed.
- Packaged native proof: helper is Mach-O arm64; dependencies resolve to the bundled whisper framework plus Apple system libraries. A `say`-generated consent-free fixture transcribed exactly: `Waypoint local voice is ready.` No microphone or user audio was accessed.
- Signing: package is unsigned because no valid Developer ID identity is installed; this remains the existing release gate and does not block local packaged verification.

## Review

- Initial independent verdict found 1 high, 4 medium and 2 low: missing macOS 13.3 gate; incomplete dynamic package proof; transient local-model preferences; mac-only resources globally packaged; and insufficient protected-key activation integration.
- Repairs added builder/runtime OS gating, executable package closure, schema-24 workspace/device-local preferences mirrored in Settings/composer, mac-scoped resources, strict provider IPC and protected-vault integration coverage.
- Final independent verdict: **0 blocker / 0 high / 0 medium / 1 low — clean**. The residual low is process-lifetime caching of a successful bundle hash check; package closure and future signing mitigate it.
- Final isolated-profile and normal-user-data packaged launches each produced one Waypoint window and no stderr. The latest normal-data instance remains running for inspection; no user data was reset or modified outside the schema migration and ordinary app startup.
