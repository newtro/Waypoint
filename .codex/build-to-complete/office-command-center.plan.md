# Office Command Center Experiment

## Product intent

Create an isolated, experimental Waypoint command center that presents real
agent work as a pixel-art office. The office is a new full-screen workspace
view launched from the existing sidebar. It is the experimental replacement
for chat-first interaction, but the existing chat interface and every other
Waypoint surface remain intact.

The Office Manager is the user's stable entry point. It operates as a
supervised coordinator: it turns a brief into a bounded work order, displays
the selected provider and authority profile, waits for explicit confirmation,
then dispatches and monitors a real Waypoint chat execution within that exact
boundary.

## Locked decisions

- Entry point: sidebar menu item named `Command Center` with an experimental
  label; opens a normal full-screen Waypoint workspace tab.
- Interaction: point-and-click. A walkable user avatar is deferred.
- Existing chat: unchanged and always available as a detailed fallback.
- Truthfulness: every worker, status, approval, and deliverable is derived from
  current Waypoint data. Decorative animation may add atmosphere but must not
  imply work that is not occurring.
- Authority: the manager cannot silently broaden the brief, change the chosen
  provider/profile, bypass approval, or invent additional agents.
- Persistence: no database or migration changes. Experimental UI state may be
  local component state or local storage.
- Visual assets: original project-bound art only; do not copy third-party
  Pixel Office or Pixel Agents assets.

## Explicit non-goals

- Replacing or deleting the current chat implementation.
- Changing provider runtimes, authentication, tool policy, approvals, or
  security profiles.
- Autonomous multi-agent decomposition or reassignment beyond the confirmed
  work order.
- A separate Electron window, multiplayer office, layout editor, mobile-native
  controls, avatar walking, or new remote services.
- Claiming that visual activity represents unexposed provider internals.

## Phase 1 — Isolated route and truthful office state

### Task 1.1 — Add the Command Center workspace entry point

- Outcome: `Command Center` appears in workspace tools and opens a closable,
  full-screen `office` workspace tab without changing existing navigation.
- Files/subsystems: `src/main-tabs.ts`, `src/main.tsx`, focused tests.
- Integration path: sidebar → `openViewTab("office")` → active workspace tab →
  office component.
- Automated proof: tab helper tests plus TypeScript build and lint.
- Runtime proof: launch the real renderer and open/close/reopen the tab.

### Task 1.2 — Derive truthful office entities

- Outcome: pure adapter functions convert current chats, executions, provider
  requests, provider sessions, and authority profiles into display-safe agent
  state without fabricating progress.
- Required states: working, waiting for approval, completed, failed/canceled,
  and idle/recent conversation.
- Files/subsystems: new `src/office/office-state.ts` and tests.
- Automated proof: focused state precedence, stale data, and empty-state tests.
- Runtime proof: office view renders the current workspace with no new backend.

## Phase 2 — Pixel office and direct inspection

### Task 2.1 — Build the office floor

- Outcome: an original, polished pixel-art command center displays an Office
  Manager desk, worker desks, meeting area, delivery area, and real agent
  occupants. It remains usable if the image asset fails.
- Files/subsystems: project-bound generated asset under `src/assets/office/`,
  new `src/office/OfficeCommandCenter.tsx`, new office stylesheet.
- Automated proof: component tests cover labels, empty state, selection, and
  asset-independent semantics; build verifies asset bundling.
- Runtime/visual proof: inspect the real view at desktop and narrow widths,
  including dark and light appearance where available.

### Task 2.2 — Make every visible agent inspectable

- Outcome: selecting the manager, an agent, approval bubble, or delivery opens
  an office-native inspector showing the real objective/status/provider,
  authority summary, latest factual activity, and available actions.
- Integration path: office occupant → inspector → existing conversation,
  cancel action, or existing approval resolution.
- Automated proof: component interaction tests and callback assertions.
- Runtime proof: open a real conversation from an office occupant and return to
  the still-open command center tab.

## Phase 3 — Supervised Office Manager work orders

### Task 3.1 — Create and review a bounded work order

- Outcome: clicking the Office Manager opens a brief composer. The user enters
  an objective, chooses an available provider and existing security profile,
  and receives a clear review screen. Nothing executes before confirmation.
- Required review fields: objective, provider, model/default behavior,
  authority profile, repository boundary, and confirmation language.
- Automated proof: validation, edit/back, cancel, provider availability, and
  no-dispatch-before-confirmation tests.
- Runtime proof: prepare and cancel a work order; verify no chat/run was added.

### Task 3.2 — Dispatch and monitor real work

- Outcome: confirmation creates a real Waypoint chat, adds the exact user
  brief, starts the selected provider using the selected authority profile,
  refreshes office state, and selects the new worker. Failures remain visible
  and recoverable without false success.
- Integration path: manager confirmation → existing `createChat`, `addMessage`,
  and provider run APIs → existing refresh/polling → office worker.
- Automated proof: callback/integration tests cover exact payload, single
  dispatch, busy/error behavior, and OpenRouter/local routes.
- Runtime proof: dispatch a safe real task and observe the created worker and
  factual lifecycle; preserve the existing chat fallback.

## Phase 4 — Product polish and validation

### Task 4.1 — Accessibility, responsiveness, and failure polish

- Outcome: keyboard navigation, visible focus, reduced-motion behavior, live
  status text, narrow-window layout, empty/loading/error states, and asset
  fallback are production-quality.
- Automated proof: focused accessibility semantics tests, lint, full tests,
  and production build.
- Runtime/visual proof: inspect representative states in the real app, check
  console/runtime errors, and capture screenshots.

### Task 4.2 — Preserve Waypoint boundaries

- Outcome: existing chat, provider security, approvals, workspace switching,
  and other workspace tools behave as before; no persistence migration or
  external authority was introduced.
- Automated proof: full suite, build, lint, product-help verification, and
  `git diff --check`.
- Runtime proof: navigate between Command Center, existing chat, Settings, and
  another workspace tool; close/reopen the office.
- Manual proof: user visually approves the polished command center before final
  whole-project review and completion.

## Completion gate

- Every phase passes its automated and runtime gates.
- Every phase receives a fresh adversarial review with no valid BLOCKER or
  MAJOR findings.
- The user approves the final visual/interaction checkpoint.
- Two fresh whole-project reviewers independently report no valid BLOCKER or
  MAJOR findings after the final full-suite/runtime gate.
