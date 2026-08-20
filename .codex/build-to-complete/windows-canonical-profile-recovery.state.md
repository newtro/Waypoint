# Build to Complete State: Windows Canonical Profile Recovery

- Source: D:\Repos\Waypoint\.codex\build-to-complete\windows-canonical-profile-recovery.plan.md
- Repository: D:\Repos\Waypoint
- Branch: main
- Started: 2026-08-13T09:50:00-04:00
- Updated: 2026-08-13T10:22:00-04:00
- Baseline worktree: dirty with pre-existing provider parity, automation, packaging, theme, and acceptance changes recorded by `git status --short`; these must be preserved
- Current phase: 1 of 3
- Overall status: BLOCKED
- Build status: NOT_RUN
- Confidence: LOW

## Phase ledger

### Phase 1 — Preserve and recover the redirected workspace

- Status: BLOCKED
- Tasks: 3/3
- Fix cycles: 4/4
- Review cycles: 4
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

##### Task 1.1 — Preserve both profiles

- Outcome: Consistent read-only recovery copies of canonical and redirected database journals and owned files exist outside both live profiles.
- Non-goals: Do not replace, delete, or mutate either live profile.
- Files/subsystems: Windows AppData profiles and a dated local recovery directory.
- Artifacts: File manifest with sizes, timestamps, and SHA-256 values.
- Integration path: Live profile files -> recovery copies -> validated source store.
- Automated proof: Hash manifest and SQLite integrity/query checks on copies.
- Runtime proof: Canonical installed app remains launchable.
- Visual/manual proof: Not required.
- Decisions/external inputs: None; all data is user-authorized test data.

##### Task 1.2 — Export and restore SCv2

- Outcome: `SCv2` is restored as a distinct canonical workspace without overwriting existing workspaces.
- Non-goals: Do not blindly replace the canonical database or delete the source.
- Files/subsystems: WorkspaceStore export/restore, attachments, execution-root binding.
- Artifacts: Validated archive and restore receipt.
- Integration path: Redirected store -> `exportWorkspace` -> canonical `restoreWorkspace`.
- Automated proof: Workspace/chat/message/content counts and exact prompt query.
- Runtime proof: Canonical store reopens and lists recovered workspace.
- Visual/manual proof: Installed app lists SCv2 after restart.
- Decisions/external inputs: None.

#### Task evidence

- [x] Task 1.1 — DONE
  - Evidence: `C:\Users\scott\Documents\Waypoint Recovery\2026-08-13-profile-split` contains 116 copied source files / 125,340,214 bytes plus `manifest.json`; manifest SHA-256 `8EB833CE0E35AE1ABACD4C266350896FE23AD2464886ED04FD70F1A03D94F395`.
  - Evidence: canonical copy `PRAGMA integrity_check` returned `ok`; redirected copy was preserved byte-for-byte before official SQLite recovery identified malformed schema state.
- [x] Task 1.2 — DONE
  - Evidence: official SQLite 3.53.4 recovery tool was downloaded from sqlite.org and verified against published SHA3-256 `88b4659fe747896b853af10157316b4ade143553efb89c1c8ca7423a278dcc8b`.
  - Evidence: recovered archive `SCv2-recovered.waypoint.json` passed Waypoint archive validation, 119,571 bytes, integrity `7d5e9169373fad9d382eb9ed4e0e425d0491e3da906bae58d1500dc0452ed48b`.
  - Evidence: canonical restored workspace `bdf50441-4642-40a1-b481-77fb5c411977` is named `SCv2`, binds `D:\Mathew Repos\SCV2`, and contains `Morning Greeting` plus `New chat` with the exact recovered PR-review prompt.
  - Evidence: amendment archive `SCv2-recovered-complete.waypoint.json` contains the two recovered execution histories/events and a clearly labeled substitute capture; 119,571 bytes, integrity `f5b002216665d964181f4e7d88c6cb0648b688bc1d2274b8ea921c712a70f300`.
  - Evidence: original capture metadata and missing-byte disposition are explicit in `SCv2-recovery-amendment-receipt.json`; original SHA-256 `09e1c494...` bytes were absent from both live and preserved redirected profiles, while the user-provided 1434x624 screenshot captured 16 seconds later was restored as a non-identical substitute with SHA-256 `95b33a14...`.
- [x] Task 1.3 — DONE
  - Evidence: canonical SQLite integrity after restore returned `ok`; pre-existing workspace IDs `58d04af8-ab93-459a-908e-d74eee445739` and `96fe4abb-3a4f-41ec-b854-486ac5a10c33` remain present and unchanged.
  - Evidence: source redirected profile remains intact; recovery receipt is `C:\Users\scott\Documents\Waypoint Recovery\2026-08-13-profile-split\SCv2-recovery-receipt.json`.

#### Review log

- Review 1: ISSUES_FOUND — 1 BLOCKER, 1 MAJOR, 0 MINOR.
- Finding: BLOCKER — reconstruction omitted recoverable execution/screen-capture metadata and silently omitted an attachment whose bytes were already absent.
  - Disposition: VALID.
  - Reason: official SQLite recovery rows proved the extra SCv2 inventory.
  - Fix/evidence: added two execution histories/events, explicitly inventoried the missing original attachment, and restored the user-provided screenshot from 16 seconds later as a truthfully labeled substitute; complete amendment archive/receipt above.
- Finding: MAJOR — one-time recovery scripts were not idempotent across rerun or receipt-write failure.
  - Disposition: VALID.
  - Reason: scripts mutated archives before checking canonical/receipt state.
  - Fix/evidence: both recovery scripts now reconcile durable receipts, archive integrity, canonical workspace contents, execution count, and capture count before returning `already_recovered` / `already_amended`; rerun passed without mutation or duplicate rows.
- Finding: uncertainty — official sqlite3 `-readonly` recreated empty WAL/SHM sidecars while inspecting WAL-mode copies/live canonical DB.
  - Disposition: VALID tool side effect, no content loss.
  - Reason: main database hashes/content remained intact; future evidence checks avoid claiming sidecar mtimes are immutable.
- Review 2: ISSUES_FOUND — 1 BLOCKER, 3 MAJOR, 0 MINOR.
- Finding: BLOCKER — generated recovery-time execution IDs/hashes/timestamps were presented in place of recoverable original provenance.
  - Disposition: VALID.
  - Reason: original execution rows and all 14 events were recoverable from official SQLite output.
  - Fix/evidence: canonical and reconstructed source now contain original execution IDs `2adeac20-...` / `7b9b5c9d-...`, original prompt hashes, create/start/finish timestamps, exact error text, 14 original event IDs/sequences/timestamps, with only workspace/chat/message/security-profile foreign keys safely remapped.
- Finding: MAJOR — base receipt-write failure was not reconcilable.
  - Disposition: VALID.
  - Fix/evidence: base recovery now locates an exact existing source/canonical workspace by prompt, resumes archive/receipt creation, rejects same-name conflicts, and never duplicates a workspace after a missing receipt.
- Finding: MAJOR — partial amendment could strand one execution/capture.
  - Disposition: VALID.
  - Fix/evidence: exact execution reconciliation is one SQLite transaction with stable original IDs and independently ensures the substitute capture by SHA-256; incomplete generated recovery rows are removed by their known hashes only; invariant requires 2 exact executions and 14 events before receipt.
- Finding: MAJOR — receipt checks trusted stored integrity text.
  - Disposition: VALID.
  - Fix/evidence: both scripts now call `readBackupReadonly` for full archive validation/integrity recomputation and verify exact file byte counts before accepting a receipt.
- Evidence: both scripts reran as `already_recovered` / `already_amended` with unchanged versioned receipt timestamps/integrities, exact execution provenance, and no duplicate records.
- Review 3: ISSUES_FOUND — 0 BLOCKER, 2 MAJOR, 1 MINOR.
- Finding: MAJOR — amendment receipt accepted missing/corrupt events or attachment bytes because it checked only execution IDs/hashes/times and capture metadata.
  - Disposition: VALID.
  - Fix/evidence: version 3 receipt validation compares every original execution field, all 14 event IDs/sequences/types/text/names/raw types/timestamps/metadata, capture metadata, and SHA-256 of canonical attachment bytes.
- Finding: MAJOR — reconciliation depended on an ephemeral `%TEMP%` screenshot even after durable source/archive bytes existed.
  - Disposition: VALID.
  - Fix/evidence: `SCv2-substitute-capture-95b33a1437b4f899.png` is now a durable 75,394-byte recovery artifact with SHA-256 `95b33a1437b4f899431fd29ef362a7bd6d66a3c16fe188d88fefdc5d10a840be`; recovery falls back in order to this artifact, reconstructed source, or validated archive and no longer requires `%TEMP%` after initial preservation.
- Finding: MINOR — state ledger archive sizes/integrities were stale.
  - Disposition: VALID.
  - Fix/evidence: current values above match versioned receipts and fully validated archives.
- Review 4: ISSUES_FOUND — 0 BLOCKER, 2 MAJOR, 0 MINOR.
- Finding: MAJOR — malformed/truncated amendment archive threw out of receipt validation instead of entering repair.
  - Disposition: VALID.
  - Fix/evidence: version 4 validation catches every archive/database/attachment validation error and returns false so recovery continues from durable substitute/source/prior valid material.
- Finding: MAJOR — amendment receipt did not prove the full workspace/disclosure/archive contract or decoded archive attachment hashes.
  - Disposition: VALID.
  - Fix/evidence: version 4 validates exact workspace name/root, both chat titles, all three exact messages, original capture disclosure object, durable substitute receipt, mode/source ID/source name/time/dimensions, canonical attachment bytes, archive attachment decoded bytes/hash, all execution fields, and all 14 event fields. Version 4 rerun returned `already_amended` only after the complete contract passed.
- Review 5 after fix cycle 4: ISSUES_FOUND — 0 BLOCKER, 2 MAJOR, 0 MINOR.
- Finding: MAJOR — malformed receipt JSON is parsed outside the guarded invalid-receipt path in both one-off recovery scripts.
  - Disposition: VALID; unresolved because the four permitted fix cycles are exhausted.
- Finding: MAJOR — audit validation still omits archive execution root, durable receipt summary sections, and remapped execution relationship fields/counts.
  - Disposition: VALID; unresolved because the four permitted fix cycles are exhausted.

##### Task 1.3 — Verify recovery safety

- Outcome: Existing canonical workspaces are unchanged and source remains intact.
- Non-goals: No cleanup of source profile.
- Files/subsystems: Both profile roots.
- Artifacts: Before/after manifests and workspace summaries.
- Integration path: Reopen both stores after recovery.
- Automated proof: Existing IDs/counts preserved; source hashes retained.
- Runtime proof: Restart persistence.
- Visual/manual proof: Not required.
- Decisions/external inputs: None.

## Deferred MINOR findings

- None.

## Blockers

- Build-to-complete Phase 1 exhausted four fix cycles with two valid MAJOR recovery-utility edge cases remaining. Current canonical SCv2 data and durable artifacts are internally correct; user direction is required to restart Phase 1 with a materially different recovery-module/test-harness approach or freeze the one-time recovery and proceed to the product profile-routing phase.
