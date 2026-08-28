# Waypoint Trusted Device Fabric — Complete Build Plan

## Product contract

Waypoint becomes a personal, local-network device fabric. A user pairs each Waypoint installation once, sees every known instance from the Command Center, accesses a unified catalog of workspace knowledge with provenance, assigns real agent work to a chosen computer, hands Git work between isolated worktrees, supervises execution live, and can open an unattended remote desktop session. The feature is additive: existing local workspace/chat behavior remains available.

### Locked decisions

- Discovery and transport are local-network only for this release; no account, cloud rendezvous, or internet-exposed listener.
- Pairing grants full personal-device trust for all current and future workspaces.
- Trust records converge locally after interruption, but no consequential operation is authorized by a trust record alone. Every workspace-key, content, execution, Git-handoff, supervision, or desktop-control request requires a fresh short-lived scope-bound proof signed by both devices; stale, absent, asymmetric, or unverifiable proof fails closed.
- Data uses a unified fleet catalog with on-demand encrypted caching and optional workspace pinning, not an unconditional full mirror.
- Fleet search and Office Manager context may span trusted workspaces, but every result retains source workspace, permissions, provenance, and deletion lifecycle.
- A background Device Host starts at user sign-in. Windows close hides to a tray icon; macOS receives corresponding background/menu behavior. Explicit Quit stops the host.
- Remote execution offers Supervised and Autonomous modes, configured per-device with a per-task override.
- Coding handoff uses a Git branch/commit when possible and an encrypted patch bundle otherwise; target work occurs in an isolated worktree and must not disturb an existing dirty checkout.
- Task interaction modes are Results only, Live supervision, View desktop, and Control desktop.
- Full-trust pairing permits unattended remote desktop by default, with a visible target indicator, immediate disconnect/pause/revoke, and non-bypassable OS consent boundaries.

### Global non-goals and authority boundaries

- No hosted relay, WAN discovery, NAT traversal, Waypoint account, multi-user organization, or public listener.
- No silent elevation, lock-screen bypass, secure-attention bypass, Keychain/UAC bypass, or fabrication of remote success.
- Repository transfer does not replace Git and does not overwrite a target checkout.
- Workspace provenance and hard-deletion ownership remain intact even when search is fleet-wide.
- Unlinked discovery advertisements disclose only bounded device name, platform, app version, endpoint, and signed identity fingerprint.
- Existing uncommitted sync-recovery work listed in the state file is protected baseline work and may be refactored only when the same behavior is preserved by the fleet model.

## Phase 1 — Baseline recovery and device-level security foundation

### Tasks

1. Preserve and integrate the current invitation/leave-sync recovery changes; restore the full repository gate or document a verified pre-existing exception.
2. Add a versioned protected device identity and trust registry independent of any workspace, with stable installation ID, signing/encryption keys, device metadata, revocation, and atomic persistence under OS protection.
3. Implement a device-level authorization contract that derives workspace grants beneath fleet trust without flattening per-workspace encryption or provenance.
4. Add migrations and compatibility behavior for existing workspace-scoped sync identities; no workspace content may be deleted or silently merged.

### Acceptance contract

- A device identity survives restart, never appears in plaintext storage, and is not tied to the selected workspace.
- Revocation and trust-state transitions fail closed and are covered by persistence, corruption, migration, and isolation tests.
- Existing workspace content remains readable and the current device-only leave workflow remains content-preserving.
- Automated proof: lint, build, full unit/integration suite, protected-vault and migration tests.
- Runtime proof: restart the app twice and observe the same sanitized local device identity and unchanged workspaces.

## Phase 2 — LAN discovery, pairing, background host, and device network UI

### Tasks

1. Implement bounded LAN discovery for running Waypoint Device Hosts, with signed advertisements, expiry, interface changes, duplicate suppression, and no trust-on-discovery.
2. Implement mutual pairing with a short matching code, pinned TLS identity, replay/expiry protection, full-fleet trust creation, explicit unlink/revoke, and reconnect after restart.
3. Implement the user-level background host and start-at-sign-in policy. On Windows, close-to-tray must keep host/sync/work running; tray/menu actions expose Open, Command Center, pause work, pause sync, start-at-sign-in, and Quit.
4. Add a Command Center Device Network surface showing unlinked, link requested, trusted online, trusted offline, working, needs attention, paused, version, platform, capabilities, and last seen.

### Acceptance contract

- Two isolated app instances on one LAN discover each other without a code being pasted; unlinked instances cannot query content or execute work.
- Matching-code pairing creates durable reciprocal pinned trust intent exactly once; active authority requires fresh mutual proof, so response loss or one-sided persistence cannot authorize work. Replay, wrong code, expiry, impersonation, and revoked peers fail closed.
- Closing the Windows window leaves the process, host, tray, and paired presence running; Quit shuts them down cleanly. macOS build retains normal background behavior.
- Device cards update honestly across connect, disconnect, pause, restart, version mismatch, and revoke.
- Automated proof: protocol, discovery, pairing, tray lifecycle, persistence, IPC, and browser UI tests plus lint/build/full suite.
- Runtime proof: two local profiles pair, reconnect, close/reopen the window, and unlink through the rendered app.
- Visual proof: Device Network and tray behavior inspected in the actual packaged/development desktop app.

## Phase 3 — Unified fleet catalog, search, smart cache, and automatic workspace grants

### Tasks

1. Publish an authenticated per-device workspace catalog covering current and future workspaces, counts, freshness, availability, and cache/pin state without exposing content to untrusted peers.
2. Automatically grant trusted devices access to workspace keys beneath full-fleet trust, preserving independent workspace encryption, device-local roots, revocation, and key rotation.
3. Implement fleet-wide search/query fan-out with source device/workspace provenance, deterministic result merging, bounded failure behavior, and offline/cache truthfulness.
4. Implement on-demand encrypted object/attachment caching, explicit workspace pin/unpin, cache eviction that does not delete authoritative content, and restart-safe synchronization.
5. Integrate the unified catalog/search into navigation, Knowledge, and Office Manager context while retaining existing workspace filters and deletion boundaries.

### Acceptance contract

- A newly linked device automatically sees all current workspaces and subsequently created workspaces without another pairing flow.
- Cross-workspace results remain attributed to the exact source and obey revocation/deletion immediately.
- Opening an uncached result fetches only the required encrypted content; pinning yields complete offline access within declared attachment bounds; eviction removes only cache copies.
- Offline devices and partial results are labeled; no fabricated complete search is shown.
- Automated proof: multi-store catalog/search/cache convergence, automatic grant, rotation/revoke, attachment, deletion, restart, and UI tests plus full gates.
- Runtime proof: two app profiles create/search/open/pin/unpin data across multiple workspaces and survive restart/disconnect.

## Phase 4 — Fleet remote work, operating modes, and isolated worktree handoff

### Tasks

1. Promote remote jobs from workspace enrollment to trusted-device routing with platform, repository, tool, model, memory, availability, and capability inventory.
2. Implement per-device Supervised/Autonomous defaults and per-task override; retain explicit roots/capabilities, audit receipts, cancellation, lease/idempotency, timeouts, and hard OS boundaries.
3. Execute real target-local Codex, Claude, and Grok work through existing provider runtimes, using the target device's local identities and never exporting its secrets.
4. Implement repository inventory and isolated handoff: Git ref/commit transport, encrypted patch bundle fallback, base/digest verification, safe worktree creation, dirty-checkout protection, artifact/result return, review, apply/retain/discard, and cleanup.
5. Make the Office Manager choose or explain the target and dispatch only after the visible task/device/mode/root contract is established.

### Acceptance contract

- A PC can send a bounded coding task or existing change set to a Mac-designated worker, which performs it in an isolated target worktree and returns truthful results without touching its ordinary checkout.
- Supervised mode pauses consequential requests; Autonomous mode proceeds within granted roots/capabilities; per-task override is honored and audited.
- Disconnect/reconnect, duplicate delivery, cancellation, timeout, target failure, base mismatch, dirty trees, missing tools, and revoked trust converge safely.
- Automated proof: two-store job convergence, provider adapters, policy modes, worktree/patch/git handoff, replay, restart, cancellation, and UI tests plus full gates.
- Runtime proof: two local profiles complete a real disposable-repository change/build/test handoff with streamed receipts and returned artifact.

## Phase 5 — Live supervision and Command Center integration

### Tasks

1. Stream bounded remote job events, commands, logs, approvals, test results, artifacts, screenshots, and terminal state with reconnectable cursors and redaction.
2. Add Results only, Live supervision, pause, resume, redirect/message, cancel, and take-over/handoff controls.
3. Integrate devices and running work into the Office Command Center so the Office Manager, workers, workspaces, and target machines reflect real state only.
4. Add system notifications and tray/menu attention states for completed, failed, approval-needed, disconnected, and remotely controlled sessions.

### Acceptance contract

- The controlling instance can reconnect without duplicating or losing durable events and can intervene in a running task according to policy.
- UI state is derived from real jobs/sessions/approvals/devices, never timers or invented office activity.
- Sensitive command output and target secrets are redacted before transport and durable display.
- Automated proof: event ordering/cursors, redaction, reconnect, intervention, notification, office state, accessibility, and browser tests plus full gates.
- Runtime/visual proof: supervise and intervene in a real target-local disposable task from the Command Center at desktop and narrow widths.

## Phase 6 — Unattended local-network remote desktop

### Tasks

1. Implement authenticated, end-to-end protected desktop sessions over the existing pinned LAN device transport with session nonce/expiry, one active controller, rate/resource bounds, and immediate termination on revoke/pause/quit.
2. Implement target capture with display selection, adaptive frame rate/quality, resize, reconnect, blank/error detection, and honest permission state.
3. Implement View desktop and Control desktop UI with scaled pointer mapping, keyboard mapping (including Windows-to-Mac Command/Option), clipboard controls, optional bounded file transfer, multi-display selection, focus/fullscreen, and take-over/hand-back integration.
4. Implement real Windows input injection and macOS Accessibility/CoreGraphics input injection; do not claim control when permissions or native support are unavailable.
5. Add target-visible active-session/tray indicators and local disconnect/pause/revoke/emergency-stop actions. Preserve lock-screen and protected-prompt boundaries.
6. Package every required cross-platform runtime asset and document/setup macOS Screen Recording and Accessibility consent.

### Acceptance contract

- A fully linked PC can open an unattended View or Control session to an unlocked Mac on the same LAN, select a display, see live frames, use mapped pointer/keyboard input, optionally exchange clipboard/files, disconnect from either side, and reconnect without stale authority.
- A reciprocal Windows target path works with the same trust/session model.
- Unlinked/revoked/paused peers, replayed session tokens, concurrent controllers, missing permissions, lock/protected surfaces, oversized transfer, disconnect, and app quit fail closed and report the exact limitation.
- Automated proof: session authorization/state, frame bounds, coordinate/key mapping, input-adapter contracts, clipboard/file limits, reconnect/revoke, packaging-closure, IPC, and UI tests plus full gates.
- Windows runtime/visual proof: actual two-profile view/control flow on Windows where the host OS permits it.
- Required physical checkpoint: install the produced macOS ARM64 build, grant Screen Recording and Accessibility, and validate real PC-to-Mac view/control, keyboard mapping, tray/menu disconnect, agent handoff, and protected-prompt behavior.

## Whole-project completion gate

- Re-run lint, production build, full tests, help verification, package-runtime closure, Windows packaging, macOS ARM64 packaging configuration/closure, migrations, restart/reconnect, and the primary multi-device journey.
- Inspect the actual rendered Command Center, Device Network, unified search, supervision, and remote desktop surfaces.
- Complete a real disposable-repository PC-to-worker handoff and a real remote desktop session.
- Obtain the required physical Mac validation for native capture/input behavior.
- Pass a fresh adversarial review for every phase and two independent whole-project reviews with no valid BLOCKER or MAJOR findings.
