# Build to Complete State: Waypoint Trusted Device Fabric

- Source: D:\Repos\Waypoint\.codex\build-to-complete\trusted-device-fabric.plan.md
- Repository: D:\Repos\Waypoint
- Branch: main
- Started: 2026-08-21T16:12:27.0346296-04:00
- Updated: 2026-08-21T21:12:00-04:00
- Baseline worktree: modified, protected user-requested sync recovery in electron/core/product-help.test.ts, electron/core/store.ts, electron/core/sync-settings-ui.test.ts, electron/core/sync/desktop-sync-service.ts, electron/core/sync/peer-host-runtime.test.ts, electron/core/sync/workspace-sync-integration.test.ts, electron/core/sync/workspace-sync-journal.ts, electron/main.ts, electron/preload.ts, product-help/catalog.json, product-help/sync-backup-devices.md, src/main.tsx, src/settings-workspace.css, src/theme.css, and src/waypoint-api.d.ts. Baseline HEAD a02491e3d06d98a4fd925d3a4e34dfad9e4ecc41. Focused sync/help tests, lint, and production build passed; full suite had two unrelated pre-existing failures in document-ingestion PDF standard-font URL handling and a stale Grok source-shape assertion.
- Current phase: 4 of 6
- Overall status: IN_PROGRESS
- Build status: PASSING
- Confidence: HIGH

## Phase ledger

### Phase 1 — Baseline recovery and device-level security foundation

- Status: COMPLETE
- Tasks: 4/4
- Fix cycles: 4/4
- Review cycles: 5
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

- See plan Phase 1. Device identity must be protected, stable, device-scoped, migration-safe, and integrated without workspace data loss. Current device-only leave behavior remains content-preserving. Required proof includes full build/lint/tests, vault/migration coverage, and restart evidence.

#### Task evidence

- [x] Task 1.1 — DONE — Preserved the existing safe join/leave recovery, corrected the two unrelated Windows baseline failures, and restored the full 165-file/847-test gate.
- [x] Task 1.2 — DONE — Added an OS-protected, installation-scoped Ed25519/X25519 identity, stable fingerprint, protected trust registry, collision defense, atomic mutation semantics, revocation, and device-scoped signing.
- [x] Task 1.3 — DONE — Added supervised/autonomous defaults and explicit `all_current_and_future` workspace grants for active trusted devices, plus sanitized main/preload/renderer status integration.
- [x] Task 1.4 — DONE — Added versioned sidecar compatibility, legacy workspace identity adoption, workspace/sync-vault no-mutation coverage, and live restart proof with the same device identity and existing workspace content.

#### Verification evidence

- `npm run lint` — PASS.
- `npm run build` — PASS; production renderer, main, preload, and help assets built.
- `npm test` — PASS; 169 test files and 863 tests at the clean-review checkpoint, with two additional focused lifecycle/rollback regressions passing after that full gate.
- Focused phase security gate — PASS; fresh reviewer run of 9 test files and 41 tests.
- `git diff --check` — PASS.
- Placeholder scan — PASS for new device-fabric production files; matches elsewhere were legitimate input placeholders/type literals.
- Live Windows restart — PASS; two direct production-build restarts displayed `Grogo · win32` and stable installation identity prefix `ba6002f3-c02... · 0 trusted`, while workspace `QA Acceptance Restart 2026-08-06` and its existing sidebar content remained visible.

#### Review log

- Cycle 1 — ISSUES_FOUND — 1 BLOCKER, 5 MAJOR, 1 MINOR. Fixed with immutable two-generation protected storage and fault injection, semantic key/fingerprint checks, sticky revocation, fail-closed legacy migration, pre-materialized enrollment workspace compensation, and a durable/restart-reconciled leave intent. Production restart migrated the existing protected identity in place and retained prefix `ba6002f3-c02...` with existing workspace content.
- Cycle 2 — ISSUES_FOUND — 2 BLOCKER, 5 MAJOR. Fixed with independent protected revocation tombstones, sole-valid-generation-preserving semantic healing, collision rejection for existing local workspaces, protected pre-submit enrollment material plus exact idempotent relay resumption/startup reconciliation, pre-existing-directory-safe compensation, durable peer-host parent deletion, and filename-bound leave intents. Added direct rollback/resurrection/retry tests.
- Cycle 3 — CLEAN after correction — Protected sync backup healing now preserves the sole valid copy for active, pending, and host identities; relay enrollment completion is idempotent and epoch-bound; startup reconciles the protected device identity into the journal atomically and rebases unsent changes; peer-host transitions are serialized; and the leave lock covers stop, credential removal, journal/policy/root cleanup, and intent completion, including failure/retry paths. Reviewer found no remaining BLOCKER or MAJOR findings. Residual OS/power-loss and Linux runtime checks are deferred to their platform phases.

### Phase 2 — LAN discovery, pairing, background host, and device network UI

- Status: COMPLETE
- Tasks: 4/4
- Fix cycles: 4/4
- Review cycles: 7
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

- See plan Phase 2.

#### Task evidence

- [x] Task 2.1 — DONE — Added minimal signed, expiring UDP multicast discovery with duplicate suppression, protected-identity collision reporting, interface refresh, and private/loopback pinned-HTTPS endpoints; discovery alone never grants trust or exposes operational state.
- [x] Task 2.2 — DONE — Added a reciprocal six-digit pairing ceremony with TLS certificate pinning, signed requests and confirmations, two-sided confirmation, protected trust persistence, restart reconnection, unlink/revoke, and supervised/autonomous defaults.
- [x] Task 2.3 — DONE — Added the persistent Device Host lifecycle, Windows close-to-tray behavior, packaged start-at-sign-in support, tray controls for remote work and sync, separate pause semantics, and compensating shutdown when discovery startup fails.
- [x] Task 2.4 — DONE — Added an isolated Device Network workspace screen, sidebar and tray entry points, local host state, background preferences, discovered/trusted device cards, pairing UI, status badges, mode selection, unlink confirmation, responsive styling, and product help.

#### Verification evidence

- `npm run lint` — PASS.
- `npm run build` — PASS; production renderer, main, preload, and help assets built.
- Serialized `npx vitest run --maxWorkers=1` — PASS; 178 test files and 897 tests after final network-source, stale-listener, and mutual-authorization hardening. Parallel focused runs intermittently lost a Vitest worker; every affected test passed serialized and no product process remained.
- `npm run verify:product-help` — PASS; Waypoint Help `2026.08.21.5` with 8 pages.
- `git diff --check` — PASS; only repository line-ending warnings were emitted.
- Live Windows close-to-tray — PASS; closing the rendered window removed its title while root PID `67852` remained responsive, and a second-instance activation restored the window.
- Live two-instance discovery and pairing — PASS using disposable profiles `Waypoint-Phase2-A` and `Waypoint-Phase2-B`; both advertised private HTTPS endpoints, discovered each other automatically, displayed the same code `670 613`, kept the first confirmer waiting, and reached `Trusted · online` only after reciprocal confirmation.
- Live restart persistence — PASS; stopping profile B changed profile A to `Trusted · offline`, and restarting the same protected profile returned it to `Trusted · online` without re-pairing.
- Live unlink — PASS; the rendered confirmation stated workspace content would not be deleted, and confirmation returned the peer to `Ready to link`.
- Runtime shutdown gate — PASS; all disposable Waypoint Electron root and child processes were explicitly stopped before review, with no matching test process remaining.

#### Fix log

- Cycle 1 — Rendered testing found the idle Link button disabled because both the global busy token and absent pairing session ID were `undefined`. Fixed by guarding pairing-session comparison, added direct regression coverage, rebuilt, and repeated the full ceremony successfully.
- Cycle 2 — Adversarial review found 1 BLOCKER and 7 MAJOR issues. Corrected trusted-ID collision handling against active/revoked protected identity before status merging; crossed requests now select one canonical session; protected pairing sessions and confirmation receipts survive restart and retry; the host listens across interfaces and advertises a subnet-reachable endpoint per interface; work/sync pauses are independent and pairing remains available; cards render real capabilities, pause, work, and attention; the false workspace-catalog claim was removed and attention derives from actual failed/timed-out jobs; discovery no longer exposes encryption keys; pairing exchanges full identity only through pinned HTTPS; and source-only tray/UI assertions are supplemented by behavioral lifecycle and rendered component interaction/accessibility tests.
- Cycle 3 — Fresh re-review found 2 BLOCKER and 3 MAJOR issues. The host now admits only loopback or a same-subnet private peer even while listening across eligible interfaces; multicast reveals only bounded name, platform, app version, endpoint, and signed HTTPS fingerprint; keys and operational state moved behind authenticated certificate-pinned HTTPS; incoming pairing is globally bounded, per-source rate limited, and rolled back if protected persistence fails; oversized bodies are destroyed at first overflow; and current UI/help no longer claim Phase 3 workspace grants. Added direct network admission, overflow, pairing admission, persistence rollback, and authenticated-presence regressions.
- Cycle 4 — Fresh correction review found 2 BLOCKER and 4 MAJOR issues. Discovery now retains at most 128 unknown fingerprints, rate-limits each source, and bounds admission-source bookkeeping; HTTPS binds only the enumerated private interfaces (or explicit loopback in tests) and advertises only bound addresses; multicast removed the stable device ID; pairing throttles before JSON/identity/signature work and counts duplicate replays; confirmed ceremonies retain a 30-day protected recovery receipt and never commit the offline second confirmer; and a revoked host returns a signed pinned revocation result so the peer revokes reciprocal trust and stops reporting trusted-online. Added flood, interrupted-second-confirmation recovery, and reciprocal-revocation regressions.
- Cycle 4 final hardening — The final review reproduced response-loss divergence and found static interface snapshots, an unsafe explicit bind escape hatch, revocation-receipt over-disclosure, and tray expiry drift. Pair completion now atomically persists a non-authorizing pending trust record with its recovery receipt; workspace grants and active counts exclude pending trust; authenticated reciprocal presence promotes both sides; final-response loss remains non-authorizing and recovers. The runtime rejects wildcard/public explicit binds, dynamically adds/removes private-interface HTTPS listeners and updates advertisements, returns operation-free signed revocation receipts, and drives expiry notifications from the background refresh timer. Added direct response-loss, pending-grant, explicit-bind, dynamic-rebind, and expiry-notification coverage.
- Cycle 4 closeout — A final reviewer demonstrated that independent reciprocal promotion can still diverge if one activation save fails. It also found public-source multicast admission and stale advertisement after total replacement-bind failure; those concrete network issues are fixed and tested. The remaining no-one-sided-active-authority requirement cannot be made atomic across two partitionable devices under the locked no-coordinator/no-relay contract. The phase exhausted its four correction cycles and requires a product architecture decision.
- Architecture resolution — The approved local-only model now treats reciprocal trust as durable intent only. Paired records, whether pending or active, cannot grant workspace authority without a 30-second exact-scope authorization signed by both trusted device identities and exchanged over the discovered certificate-pinned private HTTPS endpoint. Missing, expired, wrong-peer, wrong-scope, tampered, or revoked proofs fail closed, including when one side is active and the other remains pending.

#### Review log

- Cycle 1 — ISSUES_FOUND — 1 BLOCKER, 7 MAJOR, 0 MINOR. Reviewer reproduced trusted-ID impersonation and divergent simultaneous pairing with non-GUI probes, then identified interrupted reciprocal commit, multi-interface reachability, dishonest pause/capability/attention state, excessive discovery disclosure, and missing behavioral UI/tray tests. All findings were corrected; focused tests reached 10 files/31 tests, then the full gate reached 177 files/884 tests. Fresh re-review pending.
- Cycle 2 — ISSUES_FOUND — 2 BLOCKER, 3 MAJOR, 0 MINOR. Reviewer identified the all-interface HTTPS listener without source-subnet admission, operational and key disclosure beyond the locked multicast boundary, unbounded/expensive incoming pairing admission, post-limit request buffering, and a premature all-workspaces UI promise. Corrections passed build, lint, 178-file/889-test full suite, help verification, diff check, and explicit no-process inspection. Fresh correction review pending.
- Cycle 3 — ISSUES_FOUND — 2 BLOCKER, 4 MAJOR, 0 MINOR. Reviewer reproduced 2,000 retained unauthenticated identities and one-sided trust when the first confirmer went offline, then identified the remaining wildcard TLS bind, stable device-ID disclosure, late/replay-bypassable admission, and dishonest post-unlink peer state. Corrections passed build, lint, 178-file/892-test full suite, help verification, diff check, and explicit no-process inspection. Final fresh correction review pending.
- Cycle 4 — ISSUES_FOUND — 1 BLOCKER, 2 MAJOR, 2 MINOR. Reviewer reproduced a dropped-final-response one-sided active vault and explicit wildcard binding, then identified stale interface snapshots, operational detail in revocation receipts, and tray expiry drift. Final hardening passed build, lint, 178-file/895-test full suite, help verification, diff check, and explicit no-process inspection. Clean-review confirmation pending.
- Cycle 5 — ISSUES_FOUND — 1 BLOCKER, 2 MAJOR, 0 MINOR. Reviewer reproduced one active/one pending authority when reciprocal activation persistence fails, stale listener advertisement after total replacement-bind failure, and public-source multicast admission. The two network findings were fixed; serialized full suite now passes 178 files/896 tests. The distributed atomic-authority blocker remains and the configured correction budget is exhausted.
- Architecture review 1 — ISSUES_FOUND — 2 BLOCKER. The compatibility path still authorized trust records without reciprocal state, and the short-lived bearer proof was replayable. Removed the bypass, migrated prior records to explicit trust intent, bound signatures to exact operation/resource/request bytes, and added a protected bounded target-side consume-once ledger.
- Architecture review 2 — CLEAN after correction — Trust-only, asymmetric, wrong-peer, wrong-scope, wrong-request, tampered, expired, revoked, reused, and restart-replayed authority fail closed. Exact request bytes are hashed before authorization, only the target consumes the proof, and the certificate-pinned countersign exchange passed focused non-GUI review.

### Phase 3 — Unified fleet catalog, search, smart cache, and automatic workspace grants

- Status: COMPLETE
- Tasks: 5/5
- Fix cycles: 3/4
- Review cycles: 3
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

- See plan Phase 3.

#### Task evidence

- [x] Task 3.1 — DONE — Added fresh-mutually-authorized, certificate-pinned workspace catalogs with bounded metadata/counts, source authority, key epoch, automatic refresh, and offline catalog truth on device cards.
- [x] Task 3.2 — DONE — Added automatic recipient-wrapped per-workspace fleet grants, protected target storage, epoch collision/staleness checks, source rotation before unlink, and revoked-source cache/key purge.
- [x] Task 3.3 — DONE — Added local-plus-remote search fan-out with deterministic merge, exact device/workspace/object/revision provenance, bounded responses, and explicit partial/unavailable device reporting.
- [x] Task 3.4 — DONE — Added exact-object AES-256-GCM caching under workspace keys, protected restart-safe cache state, online authoritative refresh, catalog/inventory deletion reconciliation, pin/unpin, bounded eviction, and complete declared inventory fetch with a 6 MiB per-attachment bound plus omitted counts.
- [x] Task 3.5 — DONE — Added Fleet Knowledge to Device Network, Knowledge, and Office Manager context; catalog counts/capabilities, result provenance, truthful local/offline behavior, open-and-cache, source-qualified pin controls, responsive styling, typed IPC/preload APIs, and updated product help.

#### Verification evidence

- Focused catalog/search/grant/cache/runtime/UI gate — PASS; authenticated runtime exchanges, restart persistence, tamper, replay, key collision, rotation, revoke, inventory, provenance, source integration, and rendered device-card tests.
- `npm run lint` — PASS.
- `npm run build` — PASS; production main, preload, renderer, and help assets built.
- Phase 3 correction gate — PASS; 23 focused runtime/cache/Office tests, production build, lint, and `git diff --check`.
- Serialized full suite after review corrections — PASS; 179 test files and 905 tests.
- Phase 3 correction cycle 2 focused gate — PASS; 5 files and 31 tests plus production build and lint.
- Serialized full suite after cycle 2 — PASS; 179 test files and 906 tests. The first attempt had the known intermittent Vitest child-worker exit after 178 passing files; the immediate clean rerun completed every file/test.
- Phase 3 correction cycle 3 — PASS; production build, lint, 5 focused files/33 tests, and serialized full suite 179 files/908 tests.
- Phase 3 correction cycle 4 — PASS; production build, lint, diff check, 5 focused files/33 tests, and serialized full suite 179 files/908 tests.
- Phase 3 correction cycle 4 atomicity refinement — PASS; production build, lint, diff check, 5 focused files/34 tests, and serialized full suite 179 files/909 tests.
- Runtime shutdown gate — PASS; no Waypoint, Electron, or Vitest process remained, and the app was not launched during review work.

#### Review log

- Cycle 1 — ISSUES_FOUND — reviewer reported 1 BLOCKER and 9 MAJOR findings. Corrected the production capability allowlist; authenticated revocation cache purge; local-result self-routing; offline/partial aggregation; source-qualified durable pins; honest incomplete/attachment-omission status; catalog/inventory deletion convergence; bounded response sizes and batched fan-out; authorization-ledger capacity; decrypted inner provenance validation; and Fleet Knowledge integration in Knowledge and Office Manager. Added direct capability, revocation, source-qualified pin persistence, and authenticated-provenance regressions. Fresh correction review pending.
- Cycle 2 — ISSUES_FOUND — 1 BLOCKER, 3 MAJOR. Added a non-bypassable active-trust check before cached open/pin plus startup reconciliation of cache sources, so a split-persistence purge failure cannot expose revoked content. Added bounded offline encrypted-cache search so pinned objects remain discoverable after restart/disconnect. Added the authenticated remote workspace catalog to Device Network with source-qualified pin controls for empty/new workspaces. Added an explicit Fleet Knowledge selection path in Office Manager that retains device/workspace/object provenance through review and into the audited message/provider prompt. Added focused restart-cache, prompt-provenance, integration-source, and revocation callback coverage. Fresh correction review pending.
- Cycle 3 — ISSUES_FOUND — 0 BLOCKER, 4 MAJOR. Transport failures now retain and fall back to a valid encrypted cache, while only an authenticated 404 discards an authoritative deletion; cached search remains available during stale-online presence. Office context now retains exact document revision provenance, reopens/reauthorizes every remote reference at final confirmation, rejects revoked/deleted sources, and rejects changed revisions before provider dispatch. Reciprocal signed revocation now removes the remote catalog immediately. Added direct cache-failure disposition and Office reauthorization/revision regressions. Fresh correction review pending.
- Cycle 4 — ISSUES_FOUND — 0 BLOCKER, 4 MAJOR. Cached search fallback is now limited to offline, unavailable, rejected, or partial peers, so a complete authoritative online search suppresses deleted cached results. Final Office confirmation now requires the source online and forces a fresh mutually authorized object fetch without cache fallback. Cache deletion requires the explicit authenticated `fleet_object_not_found` protocol code; generic/legacy 404s preserve a valid cache. Authenticated remote catalogs now persist under OS protection, survive offline restart, remain filtered by active trust, and purge on revocation. Added protected catalog restart and explicit deletion-disposition coverage. Clean-review confirmation pending.
- Cycle 4 clean-confirmation refinement — ISSUES_FOUND — 0 BLOCKER, 1 MAJOR. The reviewer reproduced a crash boundary between protected catalog persistence and deleted-workspace cache reconciliation. Replaced the two saves with one `applyCatalog` protected-state transaction that atomically updates the catalog and removes omitted workspace grants, objects, and pins. Added a restart reproduction proving an empty authoritative catalog cannot resurrect deleted cached search content. Final clean confirmation pending.
- Cycle 5 — CLEAN after correction — Fresh reviewer confirmed `applyCatalog` performs catalog replacement plus omitted-workspace grant/object/pin purge in one protected save; an independent restart/offline probe returned no resurrected content. Prior bounded fallback, fresh Office authorization/revision, explicit deletion-code, trust filtering, and revocation protections remained clean. Focused confirmation passed 6 files/34 tests with no app/test process left running.

### Phase 4 — Fleet remote work, operating modes, and isolated worktree handoff

- Status: FIXING
- Tasks: 5/5
- Fix cycles: 2/4
- Review cycles: 2
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

- See plan Phase 4.

#### Task evidence

- [x] Task 4.1 — DONE — Added a fresh-mutually-authorized target inventory with platform/architecture/memory, target-local Codex/Claude/Grok availability and versions, honest provider-default model policy, exact repository/profile roots, tool/network/filesystem/approval capabilities, pause state, and bounded validated transport.
- [x] Task 4.2 — DONE — Added protected durable supervised/autonomous work orders with per-device default and per-task override, exact target root/profile, idempotency collision rejection, target approval, cancellation, bounded timeout, restart interruption recovery, revocation cancellation, terminal receipts, and controller-side restart persistence.
- [x] Task 4.3 — DONE — Target execution routes through Waypoint's real Codex app-server, Claude Agent SDK, and Grok ACP workbenches using only target-local executables/identities. The selected target profile is rebound to the isolated worktree without exporting secrets or expanding its duration/root authority.
- [x] Task 4.4 — DONE — Added clean Git-bundle and tracked-dirty binary-patch handoff, digest/base verification, isolated managed worktrees, untracked-file rejection, dirty-checkout preservation, committed/staged/unstaged/new-file result capture, changed-path review, explicit base-checked apply, retain, discard, and cleanup.
- [x] Task 4.5 — DONE — Office Manager now exposes local/remote target choice, authenticated target inventory, exact repository/profile, supervised/autonomous mode, provider/model truth, separate controller and target authority contracts, final confirmation, and real remote dispatch. Device Network exposes durable target approvals and controller refresh/cancel/review/apply/retain/discard actions.

#### Verification evidence

- Correction cycle 1 focused Phase 4 gate — PASS; 7 files and 47 tests covering durable work lifecycle, persisted target/provider approvals, pre-send controller journaling, exact-order retry/collision handling, mutual authorization, transport, order-tamper rejection, post-unlink denial, inventory validation, Git bundle/patch isolation, dirty source, committed and untracked result return, base mismatch, duplicate-profile-root selection, Office validation, rendered UI source, and product help.
- Serialized full repository suite after correction cycle 1 — PASS; 181 test files and 921 tests.
- `npm run build`, `npm run lint`, `npm run verify:product-help`, and `git diff --check` — PASS.
- Runtime UI — PASS after correction; actual production-build Electron rendered the fully styled Command Center, Office Manager task composer, target-machine/provider/controller-authority/repository contract, online Device Host, Fleet Knowledge, and Fleet Work. The Vite-only launch reproduced an unstyled oversized mark because strict production CSP blocks Vite's injected inline CSS; the external-CSS production renderer used by packaged builds loaded correctly.
- Shutdown gate — PASS; the Electron process was terminated after each Computer Use pass and no Waypoint, Electron, or Vitest process remained before review.

#### Review log

- Cycle 1 — ISSUES_FOUND — 3 BLOCKER, 8 MAJOR, 1 MINOR. Valid findings: supervised provider requests were auto-accepted; provider completion lacked a hard wall-clock deadline; controller tracking began only after submit response; queued jobs lacked startup/expiry reconciliation; apply was not bound to the originally confirmed controller root/profile; duplicate target-profile roots were not selectable; returned status/control records lacked exact order-digest verification; provider output summaries were unbounded; inventory availability/model policy could disagree with execution; target approval omitted contract details/reject; committed-only returned paths appeared clean. Correction cycle in progress.
- Cycle 1 corrections — Implemented protected per-provider supervised approvals with explicit allow/decline, target task rejection, absolute deadline enforcement, startup/expiry reconciliation, pre-send exact-order controller journaling with stable idempotent ambiguous-response retry, exact response/order digest checks, controller-root/profile/workspace-write apply binding, composite target profile/root selectors, bounded redacted output, provider-version pinning and provider-default model policy, honest executable inventory, complete target contract review, and staged baseline-to-result changed-path capture. All focused/full/runtime/shutdown gates pass; fresh reviewer confirmation pending.
- Cycle 2 — ISSUES_FOUND — 2 BLOCKER, 3 MAJOR. Fresh profiles had no production path to mark any security profile peer-eligible, making target roots undiscoverable. The order deadline and cancellation began after Git/CLI/provider startup and could exceed the lease. Controller tracking allowed stale nonterminal responses to overwrite terminal records. Protected 128-record bounds evicted live target/controller jobs. Ambiguous staged controller submissions lacked restart expiry and an exact-order resubmit path. Correction cycle in progress.

### Phase 5 — Live supervision and Command Center integration

- Status: PENDING
- Tasks: 0/4
- Fix cycles: 0/4
- Review cycles: 0
- User checkpoint: NOT_REQUIRED

#### Acceptance contracts

- See plan Phase 5.

### Phase 6 — Unattended local-network remote desktop

- Status: PENDING
- Tasks: 0/6
- Fix cycles: 0/4
- Review cycles: 0
- User checkpoint: REQUIRED

#### Acceptance contracts

- See plan Phase 6. Physical macOS ARM64 capture/input validation is required before completion.

## Deferred MINOR findings

- None.

## Blockers

- Resolved 2026-08-21: user selected local-only eventual trust convergence plus fresh mutual authorization on every consequential operation. Phase 2 is implementing and reviewing the scope-bound two-signature authorization primitive before advancing.
- Physical Mac validation remains a planned Phase 6 checkpoint and is not yet active.
