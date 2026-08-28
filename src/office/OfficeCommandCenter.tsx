import { useMemo, useRef, useState, type FormEvent } from "react";
import officeFloor from "../assets/office/waypoint-office-floor.png";
import { FleetKnowledgePanel } from "../device-network/FleetKnowledgePanel";
import type { BuildOfficeAgentsInput, OfficeAgent } from "./office-state";
import {
  agentsForOfficeFloor,
  buildOfficeAgents,
  officeStatusCounts,
} from "./office-state";
import {
  validateOfficeWorkOrder,
  validateOfficeFleetContextForDispatch,
  targetRootOptionValue,
  type OfficeManagerDispatchResult,
  type OfficeProviderOption,
  type OfficeWorkOrder,
  type WorkOrderValidation,
} from "./office-work-order";
import "./office.css";

export interface OfficeCommandCenterProps extends BuildOfficeAgentsInput {
  workspaceName: string;
  repositoryBoundary: string;
  providerOptions: OfficeProviderOption[];
  localDeviceId?: string;
  deviceNetwork?: Awaited<ReturnType<Window["waypoint"]["deviceNetworkStatus"]>>;
  onOpenChat(chatId: string): void;
  onCancelRun(runId: string): Promise<void> | void;
  onAuthorizeProfile(profileId: string): Promise<boolean>;
  onDispatchWorkOrder(
    order: OfficeWorkOrder,
  ): Promise<OfficeManagerDispatchResult>;
}

function providerLabel(provider: OfficeAgent["provider"]) {
  return provider === "openrouter"
    ? "OpenRouter"
    : provider === "unassigned"
      ? "Unassigned"
      : provider[0].toUpperCase() + provider.slice(1);
}

function PixelAgent({ agent }: { agent?: OfficeAgent }) {
  return (
    <span
      className={`pixel-agent ${agent?.provider ?? "manager"} ${agent?.status ?? "idle"}`}
      aria-hidden="true"
    >
      <i className="pixel-agent-hair" />
      <i className="pixel-agent-head" />
      <i className="pixel-agent-body" />
      <i className="pixel-agent-chair" />
    </span>
  );
}

export function AgentInspector({
  agent,
  busy,
  error,
  onOpenChat,
  onCancelRun,
}: {
  agent: OfficeAgent;
  busy: boolean;
  error?: string;
  onOpenChat(chatId: string): void;
  onCancelRun(runId: string): void;
}) {
  return (
    <div className="office-inspector-content">
      <p className="office-inspector-eyebrow">
        {providerLabel(agent.provider)} · live workspace record
      </p>
      <h3>{agent.title}</h3>
      <span className={`office-status-pill ${agent.status}`}>
        {agent.statusLabel}
      </span>
      <section>
        <h4>Current objective</h4>
        <p>{agent.objective}</p>
      </section>
      {agent.latestActivity && agent.latestActivity !== agent.objective && (
        <section>
          <h4>Latest reported activity</h4>
          <p>{agent.latestActivity}</p>
        </section>
      )}
      <section>
        <h4>Authority</h4>
        <p>{agent.authorityLabel}</p>
      </section>
      {agent.requestId && (
        <section className="office-request-summary">
          <h4>Needs your decision</h4>
          <p>{agent.requestTitle ?? "Provider request pending"}</p>
          <small>
            Review the conversation for the exact request details and every
            available choice.
          </small>
        </section>
      )}
      {error && <p className="office-action-error" role="alert">{error}</p>}
      <div className="office-inspector-actions">
        <button type="button" onClick={() => onOpenChat(agent.chatId)}>
          {agent.requestId ? "Review conversation" : "Open conversation"}
        </button>
        {agent.canCancel && agent.runId && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => onCancelRun(agent.runId!)}
          >
            Stop work
          </button>
        )}
      </div>
    </div>
  );
}

export function OfficeCommandCenter({
  workspaceName,
  repositoryBoundary,
  providerOptions,
  localDeviceId,
  deviceNetwork,
  onOpenChat,
  onCancelRun,
  onAuthorizeProfile,
  onDispatchWorkOrder,
  ...sources
}: OfficeCommandCenterProps) {
  const agents = useMemo(() => buildOfficeAgents(sources), [sources]),
    floorAgents = agentsForOfficeFloor(agents),
    counts = officeStatusCounts(agents),
    [selection, setSelection] = useState<string>("manager"),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState<{
      selection: string;
      message: string;
    }>(),
    [managerStep, setManagerStep] = useState<
      "overview" | "compose" | "review"
    >("overview"),
    [workOrder, setWorkOrder] = useState<OfficeWorkOrder>(() => ({
      objective: "",
      provider:
        providerOptions.find((item) => item.available)?.id ??
        providerOptions[0]?.id ??
        "codex",
      securityProfileId: sources.profiles[0]?.id ?? "",
      fleetContext: [],
    })),
    [workOrderValidation, setWorkOrderValidation] =
      useState<WorkOrderValidation>(),
    [managerBusy, setManagerBusy] = useState(false),
    [managerError, setManagerError] = useState<string>(),
    [managerNotice, setManagerNotice] = useState<string>(),
    [workerInventory, setWorkerInventory] = useState<
      Awaited<ReturnType<Window["waypoint"]["deviceNetworkWorkerInventory"]>>
    >(),
    targetInventoryRequest = useRef<string | undefined>(undefined),
    dispatchGuard = useRef(false),
    objectiveRef = useRef<HTMLTextAreaElement>(null),
    providerRef = useRef<HTMLSelectElement>(null),
    profileRef = useRef<HTMLSelectElement>(null),
    repositoryRef = useRef<HTMLElement>(null);
  const selectedAgent = agents.find((agent) => agent.id === selection),
    activeSelection = selectedAgent ? selection : "manager",
    validationProviders = workOrder.targetDeviceId
      ? providerOptions.map((provider) => {
          const remote = workerInventory?.providers.find(
            (item) => item.id === provider.id,
          );
          return {
            ...provider,
            available: Boolean(remote?.available),
            model: undefined,
            modelLabel: remote
              ? `${remote.id}${remote.version ? ` ${remote.version}` : ""} · target provider default model`
              : "Target provider inventory unavailable",
            availabilityReason: remote?.available
              ? undefined
              : remote?.reason ??
                "Provider is unavailable on the selected target device.",
          };
        })
      : providerOptions;

  async function act(
    actionSelection: string,
    action: () => Promise<void> | void,
  ) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
    } catch (reason) {
      setActionError({
        selection: actionSelection,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setBusy(false);
    }
  }

  function beginWorkOrder() {
    const provider = providerOptions.find(
      (item) => item.id === workOrder.provider && item.available,
    );
    setWorkOrder((current) => ({
      ...current,
      provider:
        provider?.id ??
        providerOptions.find((item) => item.available)?.id ??
        current.provider,
      securityProfileId: sources.profiles.some(
        (item) => item.id === current.securityProfileId,
      )
        ? current.securityProfileId
        : (sources.profiles[0]?.id ?? ""),
    }));
    setWorkOrderValidation(undefined);
    setManagerError(undefined);
    setManagerNotice(undefined);
    setManagerStep("compose");
  }

  function reviewWorkOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateOfficeWorkOrder(
      workOrder,
      validationProviders,
      sources.profiles,
      repositoryBoundary,
    );
    setWorkOrderValidation(validation);
    if (!validation.valid || !validation.order) {
      const target = validation.errors.objective
        ? objectiveRef.current
        : validation.errors.provider
          ? providerRef.current
          : validation.errors.profile
            ? profileRef.current
            : repositoryRef.current;
      target?.focus();
      return;
    }
    setWorkOrder(validation.order);
    setManagerError(undefined);
    setManagerStep("review");
  }

  async function confirmWorkOrder() {
    if (dispatchGuard.current) return;
    const validation = validateOfficeWorkOrder(
      workOrder,
      validationProviders,
      sources.profiles,
      repositoryBoundary,
    );
    setWorkOrderValidation(validation);
    if (!validation.valid || !validation.order) {
      setManagerStep("compose");
      return;
    }
    dispatchGuard.current = true;
    setManagerBusy(true);
    setManagerError(undefined);
    try {
      await validateOfficeFleetContextForDispatch(
        window.waypoint,
        localDeviceId,
        validation.order.fleetContext ?? [],
      );
      if (!(await onAuthorizeProfile(validation.order.securityProfileId))) {
        setManagerError(
          "Work order not dispatched. The selected authority profile was not enabled.",
        );
        return;
      }
      const dispatchOrder = validation.order.targetDeviceId
        ? {
            ...validation.order,
            dispatchIdempotencyKey:
              validation.order.dispatchIdempotencyKey ?? crypto.randomUUID(),
          }
        : validation.order;
      setWorkOrder(dispatchOrder);
      const result = await onDispatchWorkOrder(dispatchOrder);
      setManagerNotice(
        result.statusRefresh === "delayed"
          ? "Work started successfully, but live office status is delayed. Do not dispatch this work order again."
          : undefined,
      );
      setSelection(result.chatId);
      setManagerStep("overview");
      setWorkOrder((current) => ({
        ...current,
        objective: "",
        dispatchIdempotencyKey: undefined,
      }));
    } catch (reason) {
      setManagerError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      dispatchGuard.current = false;
      setManagerBusy(false);
    }
  }

  const selectedProvider = validationProviders.find(
      (item) => item.id === workOrder.provider,
    ),
    selectedProfile = sources.profiles.find(
      (item) => item.id === workOrder.securityProfileId,
    ),
    selectedTargetProfile = workerInventory?.roots.find(
      (item) => item.profileId === workOrder.targetProfileId,
    ),
    managerStatusLabel = managerBusy
      ? "Dispatching"
      : managerStep === "review"
        ? "Awaiting confirmation"
        : managerStep === "compose"
          ? "Drafting work order"
          : "Ready to coordinate",
    managerStatusClass = managerBusy
      ? "working"
      : managerStep === "review"
        ? "waiting"
        : "idle";

  return (
    <section className="office-command-center" aria-label="Command Center">
      <header className="office-command-header">
        <div>
          <p className="office-kicker">Experimental command layer</p>
          <h3>{workspaceName} office</h3>
          <p>Every occupant and status below comes from a real Waypoint record.</p>
        </div>
        <dl aria-label="Office status" aria-live="polite">
          <div className={counts.working ? "active" : ""}>
            <dt>Working</dt>
            <dd>{counts.working}</dd>
          </div>
          <div className={counts.waiting ? "attention" : ""}>
            <dt>Needs you</dt>
            <dd>{counts.waiting}</dd>
          </div>
          <div>
            <dt>Delivered</dt>
            <dd>{counts.delivered}</dd>
          </div>
          <div className={counts.failed ? "attention" : ""}>
            <dt>Stopped / failed</dt>
            <dd>{counts.failed}</dd>
          </div>
        </dl>
      </header>

      <div className="office-command-layout">
        <div className="office-floor-shell">
          <div
            className="office-floor"
            style={{ backgroundImage: `url(${officeFloor})` }}
            aria-label="Interactive office floor"
          >
            <span className="office-zone-label meeting">Meeting room</span>
            <span className="office-zone-label delivery">Deliveries</span>
            <span className="office-zone-label lounge">Lounge</span>
            <button
              type="button"
              className={`office-occupant manager ${activeSelection === "manager" ? "selected" : ""}`}
              aria-label="Select Office Manager"
              aria-pressed={activeSelection === "manager"}
              onClick={() => setSelection("manager")}
            >
              <PixelAgent />
              <span className="office-nameplate">
                <strong>Office Manager</strong>
                <small>{managerStatusLabel}</small>
              </span>
            </button>
            {floorAgents.map((agent, index) => (
              <button
                type="button"
                className={`office-occupant worker slot-${index} ${agent.status} ${activeSelection === agent.id ? "selected" : ""}`}
                aria-label={`Select ${agent.title}, ${agent.statusLabel}`}
                aria-pressed={activeSelection === agent.id}
                key={agent.id}
                onClick={() => setSelection(agent.id)}
              >
                {agent.status === "waiting" && (
                  <span className="office-speech-bubble" aria-hidden="true">!</span>
                )}
                <PixelAgent agent={agent} />
                <span className="office-nameplate">
                  <strong>{providerLabel(agent.provider)}</strong>
                  <small>{agent.statusLabel}</small>
                </span>
              </button>
            ))}
          </div>

          <nav className="office-roster" aria-label="Office roster">
            <span>
              <strong>Team roster</strong>
              <small>{agents.length} real conversation{agents.length === 1 ? "" : "s"}</small>
            </span>
            <div>
              {agents.map((agent) => (
                <button
                  type="button"
                  className={`${agent.status} ${activeSelection === agent.id ? "selected" : ""}`}
                  aria-pressed={activeSelection === agent.id}
                  key={agent.id}
                  onClick={() => setSelection(agent.id)}
                >
                  <i aria-hidden="true" />
                  <span>{agent.title}</span>
                  <small>{providerLabel(agent.provider)}</small>
                </button>
              ))}
              {!agents.length && <p>The office is quiet.</p>}
            </div>
          </nav>
        </div>

        <aside
          className="office-inspector"
          aria-label="Office inspector"
          aria-live="polite"
        >
          {selectedAgent ? (
            <AgentInspector
              agent={selectedAgent}
              busy={busy}
              error={
                actionError?.selection === activeSelection
                  ? actionError.message
                  : undefined
              }
              onOpenChat={onOpenChat}
              onCancelRun={(runId) =>
                void act(activeSelection, () => onCancelRun(runId))
              }
            />
          ) : (
            <div
              className="office-inspector-content manager"
              aria-busy={managerBusy}
            >
              <p className="office-inspector-eyebrow">Front desk</p>
              <h3>Office Manager</h3>
              <span className={`office-status-pill ${managerStatusClass}`}>
                {managerStatusLabel}
              </span>
              {managerStep === "overview" && (
                <>
                  <FleetKnowledgePanel
                    context="office"
                    localDeviceId={localDeviceId}
                    onSelect={(reference) => {
                      setWorkOrder((current) => ({
                        ...current,
                        fleetContext: [
                          ...(current.fleetContext ?? []).filter(
                            (item) =>
                              item.sourceDeviceId !== reference.sourceDeviceId ||
                              item.workspaceId !== reference.workspaceId ||
                              item.objectId !== reference.objectId,
                          ),
                          reference,
                        ].slice(-8),
                      }));
                      setManagerNotice(
                        `Added ${reference.title} from ${reference.workspaceName} to the next work order.`,
                      );
                    }}
                  />
                  <section>
                    <h4>Role</h4>
                    <p>
                      Turn your objective into a bounded work order, confirm
                      its provider and authority, then coordinate the real
                      agent doing the work.
                    </p>
                  </section>
                  <section>
                    <h4>Supervision rule</h4>
                    <p>
                      Nothing starts until you review the work order. The
                      manager cannot broaden that approved boundary silently.
                    </p>
                  </section>
                  {managerError && (
                    <p className="office-action-error" role="alert">
                      {managerError}
                    </p>
                  )}
                  {managerNotice && (
                    <p className="office-action-notice" role="status">
                      {managerNotice}
                    </p>
                  )}
                  <div className="office-inspector-actions">
                    <button type="button" onClick={beginWorkOrder}>
                      Begin a task
                    </button>
                  </div>
                </>
              )}
              {managerStep === "compose" && (
                <form className="office-work-order" onSubmit={reviewWorkOrder}>
                  <p>
                    Draft only. No chat or agent run is created until the final
                    confirmation screen.
                  </p>
                  <label>
                    Objective
                    <textarea
                      ref={objectiveRef}
                      value={workOrder.objective}
                      maxLength={6_000}
                      autoFocus
                      aria-invalid={Boolean(
                        workOrderValidation?.errors.objective,
                      )}
                      aria-describedby={
                        workOrderValidation?.errors.objective
                          ? "office-objective-error"
                          : undefined
                      }
                      placeholder="Describe the exact outcome and constraints…"
                      onChange={(event) =>
                        setWorkOrder((current) => ({
                          ...current,
                          objective: event.target.value,
                          dispatchIdempotencyKey: undefined,
                        }))
                      }
                    />
                    {workOrderValidation?.errors.objective && (
                      <small
                        className="field-error"
                        id="office-objective-error"
                      >
                        {workOrderValidation.errors.objective}
                      </small>
                    )}
                  </label>
                  {Boolean(workOrder.fleetContext?.length) && (
                    <section className="office-boundary-card">
                      <h4>Trusted fleet context</h4>
                      <p>
                        These exact source references will be included in the
                        agent prompt with provenance.
                      </p>
                      {workOrder.fleetContext?.map((item) => (
                        <div key={`${item.sourceDeviceId}:${item.workspaceId}:${item.objectId}`}>
                          <strong>{item.title}</strong>
                          <small>
                            {item.workspaceName} · device {item.sourceDeviceId.slice(0, 10)}…
                          </small>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              setWorkOrder((current) => ({
                                ...current,
                                fleetContext: current.fleetContext?.filter(
                                  (candidate) => candidate !== item,
                                ),
                              }))
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </section>
                  )}
                  <label>
                    Target machine
                    <select
                      value={workOrder.targetDeviceId ?? "local"}
                      onChange={(event) => {
                        const deviceId = event.target.value;
                        targetInventoryRequest.current =
                          deviceId === "local" ? undefined : deviceId;
                        if (deviceId === "local") {
                          setWorkerInventory(undefined);
                          setWorkOrder((current) => ({
                            ...current,
                            targetDeviceId: undefined,
                            targetDeviceName: undefined,
                            targetRoot: undefined,
                            targetProfileId: undefined,
                            targetProviderVersion: undefined,
                            dispatchIdempotencyKey: undefined,
                            remoteMode: undefined,
                          }));
                          return;
                        }
                        const peer = deviceNetwork?.peers.find(
                          (item) => item.deviceId === deviceId,
                        );
                        setWorkerInventory(undefined);
                        setWorkOrder((current) => ({
                          ...current,
                          targetDeviceId: deviceId,
                          targetDeviceName: peer?.displayName ?? deviceId,
                          targetRoot: undefined,
                          targetProfileId: undefined,
                          targetProviderVersion: undefined,
                          dispatchIdempotencyKey: undefined,
                          remoteMode: peer?.defaultMode ?? "supervised",
                        }));
                        void window.waypoint
                          .deviceNetworkWorkerInventory(deviceId)
                          .then((inventory) => {
                            if (targetInventoryRequest.current !== deviceId)
                              return;
                            setWorkerInventory(inventory);
                            const target = inventory.roots[0];
                            setWorkOrder((current) => {
                              const provider = inventory.providers.find(
                                (item) => item.id === current.provider,
                              );
                              return {
                                ...current,
                                targetRoot: target?.root,
                                targetProfileId: target?.profileId,
                                targetProviderVersion: provider?.version,
                              };
                            });
                          })
                          .catch((reason) => {
                            if (targetInventoryRequest.current === deviceId)
                              setManagerError(
                                reason instanceof Error
                                  ? reason.message
                                  : String(reason),
                              );
                          });
                      }}
                    >
                      <option value="local">This device</option>
                      {deviceNetwork?.peers
                        .filter(
                          (peer) =>
                            peer.trusted &&
                            peer.online &&
                            peer.capabilities.includes("remote-work"),
                        )
                        .map((peer) => (
                          <option key={peer.deviceId} value={peer.deviceId}>
                            {peer.displayName} · {peer.platform}
                          </option>
                        ))}
                    </select>
                  </label>
                  {workOrder.targetDeviceId && (
                    <>
                      {workerInventory && (
                        <p className="office-target-inventory">
                          {workerInventory.platform}/{workerInventory.architecture} ·{" "}
                          {Math.max(
                            1,
                            Math.round(workerInventory.totalMemoryMb / 1024),
                          )} GB memory ·{" "}
                          {workerInventory.providers
                            .filter((provider) => provider.available)
                            .map(
                              (provider) =>
                                `${provider.id}${provider.version ? ` ${provider.version}` : ""} (${provider.modelPolicy.replaceAll("-", " ")})`,
                            )
                            .join(", ") || "no target-local providers available"}
                        </p>
                      )}
                      <label>
                        Target repository
                        <select
                          value={
                            workOrder.targetProfileId && workOrder.targetRoot
                              ? targetRootOptionValue(
                                  workOrder.targetProfileId,
                                  workOrder.targetRoot,
                                )
                              : ""
                          }
                          onChange={(event) => {
                            const target = workerInventory?.roots.find(
                              (root) =>
                                targetRootOptionValue(
                                  root.profileId,
                                  root.root,
                                ) === event.target.value,
                            );
                            setWorkOrder((current) => ({
                              ...current,
                              targetRoot: target?.root,
                              targetProfileId: target?.profileId,
                              dispatchIdempotencyKey: undefined,
                            }));
                          }}
                        >
                          {workerInventory?.roots.map((root) => (
                            <option
                              key={`${root.profileId}:${root.root}`}
                              value={targetRootOptionValue(
                                root.profileId,
                                root.root,
                              )}
                            >
                              {root.root} · {root.profileName} · {root.filesystem} · {root.approval}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Remote mode
                        <select
                          value={workOrder.remoteMode ?? "supervised"}
                          onChange={(event) =>
                            setWorkOrder((current) => ({
                              ...current,
                              remoteMode: event.target.value as
                                | "supervised"
                                | "autonomous",
                              dispatchIdempotencyKey: undefined,
                            }))
                          }
                        >
                          <option value="supervised">Supervised · approve on target</option>
                          <option value="autonomous">Autonomous within target profile</option>
                        </select>
                      </label>
                    </>
                  )}
                  {workOrderValidation?.errors.target && (
                    <small className="field-error">
                      {workOrderValidation.errors.target}
                    </small>
                  )}
                  <label>
                    Provider
                    <select
                      ref={providerRef}
                      value={workOrder.provider}
                      aria-invalid={Boolean(
                        workOrderValidation?.errors.provider,
                      )}
                      aria-describedby={
                        workOrderValidation?.errors.provider
                          ? "office-provider-error"
                          : undefined
                      }
                      onChange={(event) =>
                        setWorkOrder((current) => {
                          const provider = event.target.value as OfficeWorkOrder["provider"];
                          return {
                            ...current,
                            provider,
                            targetProviderVersion: workerInventory?.providers.find(
                              (item) => item.id === provider,
                            )?.version,
                            dispatchIdempotencyKey: undefined,
                          };
                        })
                      }
                    >
                      {validationProviders.map((provider) => (
                        <option
                          key={provider.id}
                          value={provider.id}
                          disabled={!provider.available}
                        >
                          {provider.label}
                          {provider.available
                            ? ""
                            : ` · ${provider.availabilityReason ?? "unavailable"}`}
                        </option>
                      ))}
                    </select>
                    <small>{selectedProvider?.modelLabel}</small>
                    {workOrderValidation?.errors.provider && (
                      <small
                        className="field-error"
                        id="office-provider-error"
                      >
                        {workOrderValidation.errors.provider}
                      </small>
                    )}
                  </label>
                  <label>
                    Authority profile
                    <select
                      ref={profileRef}
                      value={workOrder.securityProfileId}
                      aria-invalid={Boolean(
                        workOrderValidation?.errors.profile,
                      )}
                      aria-describedby={
                        workOrderValidation?.errors.profile
                          ? "office-profile-error"
                          : undefined
                      }
                      onChange={(event) =>
                        setWorkOrder((current) => ({
                          ...current,
                          securityProfileId: event.target.value,
                          dispatchIdempotencyKey: undefined,
                        }))
                      }
                    >
                      {sources.profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} · {profile.filesystem} · {profile.approval}
                        </option>
                      ))}
                    </select>
                    {workOrderValidation?.errors.profile && (
                      <small
                        className="field-error"
                        id="office-profile-error"
                      >
                        {workOrderValidation.errors.profile}
                      </small>
                    )}
                  </label>
                  <section
                    className="office-boundary-card"
                    ref={repositoryRef}
                    tabIndex={-1}
                    aria-describedby={
                      workOrderValidation?.errors.repository
                        ? "office-repository-error"
                        : undefined
                    }
                  >
                    <h4>Repository boundary</h4>
                    <p>{repositoryBoundary || "No agent repository selected"}</p>
                    {workOrderValidation?.errors.repository && (
                      <small
                        className="field-error"
                        id="office-repository-error"
                      >
                        {workOrderValidation.errors.repository}
                      </small>
                    )}
                  </section>
                  <div className="office-inspector-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setManagerStep("overview")}
                    >
                      Cancel
                    </button>
                    <button type="submit">Review work order</button>
                  </div>
                </form>
              )}
              {managerStep === "review" && (
                <div className="office-work-order review">
                  <p className="office-review-warning">
                    Nothing has started. Confirm the exact boundary below.
                  </p>
                  <dl>
                    <div><dt>Objective</dt><dd>{workOrder.objective}</dd></div>
                    <div><dt>Provider</dt><dd>{selectedProvider?.label}</dd></div>
                    <div><dt>Model</dt><dd>{selectedProvider?.modelLabel}</dd></div>
                    <div>
                      <dt>Controller authority</dt>
                      <dd>
                        {selectedProfile
                          ? `${selectedProfile.name} · ${selectedProfile.filesystem} · ${selectedProfile.network} · ${selectedProfile.approval}`
                          : "Unavailable"}
                      </dd>
                    </div>
                    <div><dt>Repository</dt><dd>{repositoryBoundary}</dd></div>
                    <div>
                      <dt>Target</dt>
                      <dd>
                        {workOrder.targetDeviceId
                          ? `${workOrder.targetDeviceName ?? workOrder.targetDeviceId} · ${workOrder.remoteMode ?? "supervised"} · ${workOrder.targetRoot}`
                          : "This device"}
                      </dd>
                    </div>
                    {workOrder.targetDeviceId && (
                      <div>
                        <dt>Target authority</dt>
                        <dd>
                          {selectedTargetProfile
                            ? `${selectedTargetProfile.profileName} · ${selectedTargetProfile.filesystem} · ${selectedTargetProfile.network} · ${selectedTargetProfile.approval}`
                            : workOrder.targetProfileId ?? "Unavailable"}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Fleet context</dt>
                      <dd>
                        {workOrder.fleetContext?.length
                          ? workOrder.fleetContext
                              .map(
                                (item) =>
                                  `${item.title} · ${item.workspaceName} · ${item.sourceDeviceId.slice(0, 10)}…`,
                              )
                              .join("; ")
                          : "None"}
                      </dd>
                    </div>
                  </dl>
                  <p>
                    Confirming creates one real conversation and starts only
                    this objective with the provider and authority shown here.
                  </p>
                  {managerError && (
                    <p className="office-action-error" role="alert">
                      {managerError}
                    </p>
                  )}
                  <div className="office-inspector-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={managerBusy}
                      onClick={() => setManagerStep("compose")}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={managerBusy}
                      onClick={() => void confirmWorkOrder()}
                    >
                      {managerBusy ? "Dispatching…" : "Confirm and dispatch"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
