# Packaged runtime path repair evidence

Date: 2026-08-03

## Reproduction and cause

The real arm64 macOS package failed before opening SQLite with `ERR_MODULE_NOT_FOUND`: `dist-electron/electron/core/ai-workbench.js` imported `../../spikes/cli-capabilities.js`, while `electron-builder.yml` packaged only `dist-electron/electron/**/*`. The compiled `dist-electron/spikes` runtime subtree was therefore absent from `app.asar`.

The pre-repair process had no database file open. The user's schema remained at version 3 with one workspace and two messages, confirming the repeated failed launches did not reset or rewrite content.

## Repair and regression boundary

- Package `dist-electron/spikes/**/*` alongside the Electron runtime that imports it.
- Verify the actual packaged `app.asar` by traversing relative ESM imports from the main entry and failing on any missing module.
- Unit-test the exact missing-spike case and its repaired closure.

## Verification

- Unit suite, lint, production build, and dependency audit pass.
- Native arm64 package completes and the actual `app.asar` import-closure verifier passes.
- Normal-data native launch succeeds with one Waypoint process and no JavaScript error dialog.
- The existing workspace and two durable messages remain present after the normal schema-6 migration; the migration snapshot provides the established rollback evidence.
- Visual inspection confirms the Waypoint window renders from the repaired package.

Windows package verification remains platform-contingent. Signing and publishing remain unauthorized.
