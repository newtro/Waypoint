# Windows packaged-app acceptance prompt

Copy and paste the prompt below into Waypoint on Windows.

---

Run a real-user-style acceptance pass of the latest packaged Windows Waypoint app using its normal user profile. Exercise the actual installed UI and chat as a user would—not mocks, fixtures, or automated tests alone. All existing Waypoint workspace data on this machine is test-only, so you may use it freely. Create, modify, and clean up clearly named disposable QA workspaces and harmless test files as needed, but do not touch anything outside that QA scope.

Test and record these flows where available:

- Windows install, first launch, restart persistence, restored window size/position/maximized state, and ordinary platform behavior.
- Workspace create/select/rename/delete lifecycle and chat creation, selection, provider response, streaming, cancellation, failure, and reopen.
- Durable notes/memory across restart; Knowledge browsing/search; commitments, briefing, and reflection.
- PDF, DOCX, TXT, and Markdown import; indexing, search, provenance, reindex/delete behavior, and Windows file dialogs.
- Browser tool, In-App Browser, web search/fetch, and coding tools where configured. Check installed CLI discovery and installed browser/profile availability, including truthful unavailable states.
- Voice UI, local runtime/media readiness, device/status presentation, and permission-denied behavior without recording from the microphone. Test meeting capture only with explicit user consent.
- Cross-workspace rollups using disposable workspaces.
- Direct-host and cross-device behavior only if a second device is actually available; otherwise mark it unavailable and state the missing gate.

Capture the actual result of every attempted flow as **Pass**, **Fail**, or **Unavailable**, with concise evidence and screenshots where possible. Distinguish product bugs from intentional limitations or missing configuration. Include the exact Windows version, Waypoint package/version, discovered Codex/Claude CLI status, browser/profile status, and any Windows-specific file-dialog, voice/media, process, filesystem, or restart behavior that matters.

Safety boundaries:

- Do not use external accounts, production data, authenticated web actions, production writes, secrets, or credentials.
- Do not record from the microphone or capture a meeting without explicit user instruction and OS consent.
- Do not make product code changes during this acceptance run; report defects instead.
- Do not manufacture success. If a capability is absent, blocked, or not configured, record it truthfully.
- Clean up only disposable QA data that this run created. Leave all other local and external data unchanged.

Return a concise acceptance report grouped into passed flows, product bugs, intentional limitations/unavailable gates, evidence captured, QA cleanup performed, and recommended next repairs or user checks.
