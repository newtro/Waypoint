# Windows Canonical Profile Recovery

## Phase 1 — Preserve and recover the redirected workspace

- Preserve consistent copies of the canonical and redirected Waypoint profile data before recovery.
- Recover the missing `SCv2` workspace through Waypoint's validated export/restore semantics without overwriting existing workspaces.
- Verify the recovered workspace, chat, exact PR-review prompt, execution root, and attachment inventory in the canonical profile.
- Do not delete or modify the redirected source profile during recovery.

## Phase 2 — Canonical Windows profile routing and one-time recovery

- Resolve a stable Windows Waypoint user-data root independent of inherited packaged-app `APPDATA` virtualization; leave macOS and Linux behavior unchanged.
- Set Electron's `userData` path before any database, vault, window-state, attachment, or execution-root initialization.
- Detect the specific redirected profile that the current process would otherwise use and recover missing workspaces transactionally through validated archives.
- Never overwrite an existing canonical workspace or copy a live SQLite file wholesale.
- Keep a durable, auditable recovery receipt and retain the source profile.
- Add focused tests for normal Windows launch, packaged-parent redirection, idempotent recovery, collision handling, and failure rollback.

## Phase 3 — Installed runtime and whole-project verification

- Run focused tests, full tests, lint, build, and Windows package runtime verification.
- Exercise a packaged launch from both normal and redirected environment contexts and prove both use the same canonical profile.
- Verify `SCv2` remains visible after restart from the installed app.
- Complete a fresh phase review and two independent whole-project adversarial reviews; fix every valid BLOCKER or MAJOR.
