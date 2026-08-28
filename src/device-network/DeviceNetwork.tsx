import { useEffect, useState } from "react";
import { isDevicePeerBusy } from "./peer-busy.js";

type Network = Awaited<ReturnType<Window["waypoint"]["deviceNetworkStatus"]>>;
export type DeviceNetworkPeer = Network["peers"][number];
type Peer = DeviceNetworkPeer;
type SecurityProfile = Awaited<
  ReturnType<Window["waypoint"]["listSecurityProfiles"]>
>[number];

const statusLabels: Record<Peer["status"], string> = {
  unlinked: "Ready to link",
  "link-requested": "Link requested",
  "trusted-online": "Trusted · online",
  "trusted-offline": "Trusted · offline",
  working: "Working",
  "needs-attention": "Needs attention",
  paused: "Paused",
  "identity-conflict": "Identity conflict",
};
const capabilityLabels: Record<string, string> = {
  presence: "Presence",
  pairing: "Pairing",
  "workspace-catalog": "Workspace catalog",
  "fleet-search": "Fleet search",
  "remote-work": "Remote work",
  "live-supervision": "Live supervision",
  "desktop-view": "Desktop view",
  "desktop-control": "Desktop control",
};

function sameRepository(left: string | undefined, right: string): boolean {
  const normalize = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  return Boolean(left && normalize(left) === normalize(right));
}

export function DeviceNetwork({
  network,
  busy,
  onRefresh,
  onRequestPairing,
  onConfirmPairing,
  onUnlink,
  onMode,
  onPreferences,
  repositoryBoundary,
  profiles,
  onProfileEligibility,
}: {
  network?: Network;
  busy?: string;
  onRefresh(): void;
  onRequestPairing(deviceId: string): void;
  onConfirmPairing(sessionId: string): void;
  onUnlink(deviceId: string, displayName: string): void;
  onMode(deviceId: string, mode: "supervised" | "autonomous"): void;
  onPreferences(
    patch: Parameters<Window["waypoint"]["updateDeviceHostPreferences"]>[0],
  ): void;
  repositoryBoundary?: string;
  profiles: SecurityProfile[];
  onProfileEligibility(profileId: string, peerEligible: boolean): void;
}) {
  const [fleetQuery, setFleetQuery] = useState(""),
    [fleetSearch, setFleetSearch] = useState<
      Awaited<ReturnType<Window["waypoint"]["searchDeviceNetwork"]>>
    >(),
    [fleetSearchBusy, setFleetSearchBusy] = useState(false),
    [fleetSearchError, setFleetSearchError] = useState(""),
    [openedFleetObject, setOpenedFleetObject] = useState<
      Awaited<ReturnType<Window["waypoint"]["openDeviceNetworkObject"]>>
    >(),
    [fleetCache, setFleetCache] = useState<
      Awaited<ReturnType<Window["waypoint"]["deviceNetworkCacheStatus"]>>
    >(),
    [fleetCatalog, setFleetCatalog] = useState<
      Awaited<ReturnType<Window["waypoint"]["deviceNetworkCatalog"]>>
    >([]),
    [fleetCatalogBusy, setFleetCatalogBusy] = useState(false);
  const [controllerWork, setControllerWork] = useState<
      Awaited<ReturnType<Window["waypoint"]["controllerFleetWork"]>>
    >([]),
    [localWork, setLocalWork] = useState<
      Awaited<ReturnType<Window["waypoint"]["localFleetWork"]>>
    >([]),
    [applyCandidateJobId, setApplyCandidateJobId] = useState<string>();
  async function refreshFleetWork() {
    const [controller, local] = await Promise.all([
      window.waypoint.controllerFleetWork(),
      window.waypoint.localFleetWork(),
    ]);
    setControllerWork(controller);
    setLocalWork(local);
  }
  function reportFleetFailure(reason: unknown) {
    setFleetSearchError(reason instanceof Error ? reason.message : String(reason));
  }
  async function refreshFleetCatalog() {
    if (fleetCatalogBusy) return;
    setFleetCatalogBusy(true);
    setFleetSearchError("");
    try {
      const [catalog, cache] = await Promise.all([
        window.waypoint.deviceNetworkCatalog(),
        window.waypoint.deviceNetworkCacheStatus(),
      ]);
      setFleetCatalog(catalog);
      setFleetCache(cache);
    } catch (reason) {
      setFleetSearchError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFleetCatalogBusy(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshFleetCatalog();
      void refreshFleetWork().catch(() => undefined);
    }, 0);
    // Refresh whenever the authenticated peer/catalog snapshot changes.
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);
  async function searchFleet() {
    const query = fleetQuery.trim();
    if (!query || fleetSearchBusy) return;
    setFleetSearchBusy(true);
    setFleetSearchError("");
    try {
      const [search, cache] = await Promise.all([
        window.waypoint.searchDeviceNetwork(query, 30),
        window.waypoint.deviceNetworkCacheStatus(),
      ]);
      setFleetSearch(search);
      setFleetCache(cache);
    } catch (reason) {
      setFleetSearchError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFleetSearchBusy(false);
    }
  }
  async function openFleetResult(
    result: NonNullable<typeof fleetSearch>["results"][number],
  ) {
    setFleetSearchError("");
    try {
      const opened = await window.waypoint.openDeviceNetworkObject({
        sourceDeviceId: result.sourceDeviceId,
        workspaceId: result.workspaceId,
        objectId: result.objectId,
        objectKind: result.objectKind,
      });
      setOpenedFleetObject(opened);
      setFleetCache(await window.waypoint.deviceNetworkCacheStatus());
    } catch (reason) {
      setFleetSearchError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function toggleFleetPin(sourceDeviceId: string, workspaceId: string) {
    const pinned = !(
      fleetCache?.pins.some(
        (pin) =>
          pin.sourceDeviceId === sourceDeviceId &&
          pin.workspaceId === workspaceId,
      ) ?? false
    );
    try {
      setFleetCache(
        await window.waypoint.pinDeviceNetworkWorkspace(
          sourceDeviceId,
          workspaceId,
          pinned,
        ),
      );
    } catch (reason) {
      setFleetSearchError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  if (!network)
    return (
      <div className="device-network-loading" role="status">
        <span className="device-pulse" />
        Looking for your Waypoint devices on this network…
      </div>
    );
  return (
    <div className="device-network-view">
      <section className="device-network-hero">
        <div>
          <p className="device-network-kicker">Personal device fabric</p>
          <h3>{network.local.metadata.displayName}</h3>
          <p>
            {network.host.reason} Pair once to establish trust between these
            devices. Workspace access is granted separately.
          </p>
          <div className="device-local-meta">
            <span>{network.local.metadata.platform}</span>
            <span>{network.local.metadata.architecture}</span>
            <span>Waypoint {network.local.metadata.appVersion}</span>
            <span title={network.local.fingerprintSha256}>
              ID {network.local.localDeviceId.slice(0, 12)}…
            </span>
          </div>
        </div>
        <div className="device-host-state">
          <span className={network.host.running ? "online" : "offline"} />
          <strong>
            {network.host.running ? "Host online" : "Host offline"}
          </strong>
          <small>{network.host.endpoint ?? "No LAN listener"}</small>
          <button type="button" onClick={onRefresh} disabled={Boolean(busy)}>
            Refresh
          </button>
        </div>
      </section>

      <section
        className="device-network-preferences"
        aria-label="Background host settings"
      >
        <Preference
          label="Start at sign-in"
          detail="Make this device discoverable after you sign in."
          checked={network.preferences.startAtLogin}
          onChange={(startAtLogin) => onPreferences({ startAtLogin })}
        />
        <Preference
          label="Keep running when closed"
          detail="Closing the Windows window hides Waypoint to the tray."
          checked={network.preferences.closeToTray}
          onChange={(closeToTray) => onPreferences({ closeToTray })}
        />
        <Preference
          label="Pause remote work"
          detail="Keep presence online but do not begin queued agent work here."
          checked={network.preferences.pauseWork}
          onChange={(pauseWork) => onPreferences({ pauseWork })}
        />
        <Preference
          label="Pause sync"
          detail="Keep local data unchanged until synchronization resumes."
          checked={network.preferences.pauseSync}
          onChange={(pauseSync) => onPreferences({ pauseSync })}
        />
      </section>

      <section
        className="device-remote-profiles"
        aria-label="Remote worker authority profiles"
      >
        <header>
          <div>
            <p className="device-network-kicker">Current workspace authority</p>
            <h3>Remote worker profiles</h3>
          </div>
          <span>
            {profiles.filter((profile) => profile.peerEligible).length} advertised
          </span>
        </header>
        <p>
          Choose the exact local authority profiles trusted devices may request.
          Pairing alone never enables a profile, and every task remains bound to
          its reviewed repository and mode.
        </p>
        <div>
          {profiles.map((profile) => (
            <article key={profile.id}>
              <div>
                <strong>{profile.name}</strong>
                <small>
                  {profile.filesystem} · {profile.network} · {profile.approval}
                  {" approval · "}
                  {Math.round(profile.maxDurationMs / 60_000)} minute limit
                </small>
                <code>{profile.roots.join(" · ")}</code>
              </div>
              <button
                type="button"
                className={profile.peerEligible ? "secondary" : ""}
                aria-pressed={profile.peerEligible}
                onClick={() =>
                  onProfileEligibility(profile.id, !profile.peerEligible)
                }
              >
                {profile.peerEligible
                  ? "Stop advertising"
                  : "Allow remote requests"}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="device-fleet-search" aria-label="Fleet knowledge search">
        <header>
          <div>
            <p className="device-network-kicker">Every trusted workspace</p>
            <h3>Fleet knowledge</h3>
          </div>
          <span>Results keep their source device and workspace</span>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void searchFleet();
          }}
        >
          <input
            value={fleetQuery}
            maxLength={500}
            onChange={(event) => setFleetQuery(event.target.value)}
            placeholder="Search this PC and online trusted devices"
            aria-label="Search fleet knowledge"
          />
          <button
            type="submit"
            disabled={!fleetQuery.trim() || fleetSearchBusy}
          >
            {fleetSearchBusy ? "Searching…" : "Search fleet"}
          </button>
        </form>
        {fleetSearchError && <p className="device-security-warning">{fleetSearchError}</p>}
        <div className="device-fleet-catalog" aria-label="Trusted workspace catalog">
          <div className="device-fleet-catalog-heading">
            <strong>Trusted workspace catalog</strong>
            <button
              type="button"
              className="secondary"
              disabled={fleetCatalogBusy}
              onClick={() => void refreshFleetCatalog()}
            >
              {fleetCatalogBusy ? "Refreshing…" : "Refresh catalog"}
            </button>
          </div>
          {fleetCatalog.flatMap((catalog) =>
            catalog.workspaces.map((workspace) => {
              const pin = fleetCache?.pins.find(
                  (item) =>
                    item.sourceDeviceId === catalog.deviceId &&
                    item.workspaceId === workspace.workspaceId,
                ),
                sourceOnline = network.peers.some(
                  (peer) => peer.deviceId === catalog.deviceId && peer.online,
                );
              return (
                <article key={`${catalog.deviceId}:${workspace.workspaceId}`}>
                  <div>
                    <strong>{workspace.name}</strong>
                    <span>
                      device {catalog.deviceId.slice(0, 10)}… · key epoch{" "}
                      {workspace.keyEpoch}
                    </span>
                    <small>
                      {workspace.counts.chats} chats · {workspace.counts.documents}{" "}
                      documents · {workspace.counts.memories} memories ·{" "}
                      {workspace.counts.attachments} attachments
                    </small>
                    {pin && (
                      <small>
                        {pin.completeWithinBounds
                          ? "Offline pin complete within declared limits"
                          : "Offline pin incomplete"}
                        {pin.omittedAttachments
                          ? ` · ${pin.omittedAttachments} large attachment${pin.omittedAttachments === 1 ? "" : "s"} omitted`
                          : ""}
                      </small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!pin && !sourceOnline}
                    onClick={() =>
                      void toggleFleetPin(
                        catalog.deviceId,
                        workspace.workspaceId,
                      )
                    }
                  >
                    {pin ? "Unpin workspace" : sourceOnline ? "Pin for offline" : "Source offline"}
                  </button>
                </article>
              );
            }),
          )}
          {!fleetCatalogBusy && !fleetCatalog.some((item) => item.workspaces.length) && (
            <p>No trusted remote workspaces have been cataloged yet.</p>
          )}
        </div>
        {fleetSearch && (
          <div className="device-fleet-results" aria-live="polite">
            <p>
              {fleetSearch.results.length} result
              {fleetSearch.results.length === 1 ? "" : "s"}
              {fleetSearch.partial
                ? ` · partial (${fleetSearch.unavailableDeviceIds.length} device unavailable)`
                : " · all trusted online devices answered"}
            </p>
            {fleetSearch.results.map((result) => (
              <article
                key={`${result.sourceDeviceId}:${result.workspaceId}:${result.objectId}`}
              >
                <strong>{result.title || "Untitled"}</strong>
                <span>
                  {result.workspaceName} · {result.objectKind} · device{" "}
                  {result.sourceDeviceId.slice(0, 10)}…
                  {result.method === "cached_text" ? " · encrypted offline cache" : ""}
                </span>
                <p>{result.excerpt}</p>
                {result.sourceDeviceId === network.local.localDeviceId ? (
                  <span className="device-fleet-local-result">
                    Already on this device · open it from its workspace
                  </span>
                ) : (
                  <div className="device-fleet-result-actions">
                    <button type="button" onClick={() => void openFleetResult(result)}>
                      Open and cache
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void toggleFleetPin(
                          result.sourceDeviceId,
                          result.workspaceId,
                        )
                      }
                    >
                      {fleetCache?.pins.some(
                        (pin) =>
                          pin.sourceDeviceId === result.sourceDeviceId &&
                          pin.workspaceId === result.workspaceId,
                      )
                        ? "Unpin workspace"
                        : "Pin cached workspace"}
                    </button>
                    {fleetCache?.pins
                      .filter(
                        (pin) =>
                          pin.sourceDeviceId === result.sourceDeviceId &&
                          pin.workspaceId === result.workspaceId,
                      )
                      .map((pin) => (
                        <small key={`${pin.sourceDeviceId}:${pin.workspaceId}`}>
                          {pin.completeWithinBounds
                            ? "Pinned cache complete within limits"
                            : "Pinned cache incomplete · retry while source is online"}
                          {pin.omittedAttachments > 0
                            ? ` · ${pin.omittedAttachments} large attachment${pin.omittedAttachments === 1 ? "" : "s"} omitted`
                            : ""}
                        </small>
                      ))}
                  </div>
                )}
              </article>
            ))}
            {openedFleetObject && (
              <article className="device-fleet-opened">
                <strong>
                  Opened from {openedFleetObject.workspace.name} · {openedFleetObject.cache.sourceOnline
                    ? "refreshed from source and cached encrypted"
                    : "opened from encrypted offline cache"}
                </strong>
                <pre>{JSON.stringify(openedFleetObject.object, null, 2)}</pre>
              </article>
            )}
          </div>
        )}
      </section>

      <section className="device-fleet-work" aria-label="Fleet remote work">
        <header>
          <div>
            <p className="device-network-kicker">Target-local execution</p>
            <h3>Fleet work</h3>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => void refreshFleetWork().catch(reportFleetFailure)}
          >
            Refresh work
          </button>
        </header>
        {localWork
          .filter((job) => job.status === "waiting_approval")
          .map((job) => (
            <article key={`local:${job.order.jobId}`}>
              <strong>Approval needed on this device</strong>
              <span>
                Controller {job.order.controllerDeviceId.slice(0, 12)}… ·{" "}
                {job.order.provider}
                {job.order.providerVersion
                  ? ` ${job.order.providerVersion}`
                  : " · provider default version"}
                {" · "}{job.order.mode} · timeout{" "}
                {Math.round(job.order.timeoutMs / 60_000)} minutes
              </span>
              <small>
                Target {job.order.targetRoot} · profile {job.order.targetProfileId}
                {" · "}controller repository {job.order.controllerRoot} · profile{" "}
                {job.order.controllerProfileId}
                {job.order.handoff
                  ? ` · ${job.order.handoff.kind} ${job.order.handoff.repositoryName} base ${job.order.handoff.baseCommit?.slice(0, 12) ?? "unknown"}…`
                  : " · no repository handoff"}
              </small>
              <p>{job.order.instruction}</p>
              <div className="device-fleet-result-actions">
                <button
                  type="button"
                  onClick={() =>
                    void window.waypoint
                      .approveLocalFleetWork(job.order.jobId)
                      .then(() => refreshFleetWork())
                      .catch((reason) =>
                        setFleetSearchError(
                          reason instanceof Error ? reason.message : String(reason),
                        ),
                      )
                  }
                >
                  Approve and start
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void window.waypoint
                      .rejectLocalFleetWork(job.order.jobId)
                      .then(() => refreshFleetWork())
                      .catch(reportFleetFailure)
                  }
                >
                  Reject task
                </button>
              </div>
            </article>
          ))}
        {localWork
          .filter((job) => job.status === "running" && job.pendingApproval)
          .map((job) => (
            <article key={`provider-approval:${job.order.jobId}`}>
              <strong>Provider request needs a decision</strong>
              <span>
                {job.order.provider} · {job.pendingApproval!.kind} · target profile{" "}
                {job.order.targetProfileId}
              </span>
              <p>{job.pendingApproval!.title}</p>
              {job.pendingApproval!.detail && (
                <pre>{job.pendingApproval!.detail}</pre>
              )}
              <div className="device-fleet-result-actions">
                <button
                  type="button"
                  onClick={() =>
                    void window.waypoint
                      .resolveLocalFleetProviderApproval(
                        job.order.jobId,
                        job.pendingApproval!.requestId,
                        true,
                      )
                      .then(() => refreshFleetWork())
                      .catch(reportFleetFailure)
                  }
                >
                  Allow once
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void window.waypoint
                      .resolveLocalFleetProviderApproval(
                        job.order.jobId,
                        job.pendingApproval!.requestId,
                        false,
                      )
                      .then(() => refreshFleetWork())
                      .catch(reportFleetFailure)
                  }
                >
                  Decline request
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void window.waypoint
                      .rejectLocalFleetWork(job.order.jobId)
                      .then(() => refreshFleetWork())
                      .catch(reportFleetFailure)
                  }
                >
                  Cancel task
                </button>
              </div>
            </article>
          ))}
        {controllerWork.map((job) => (
          <article key={`controller:${job.order.jobId}`}>
            <strong>{job.order.instruction.slice(0, 120)}</strong>
            <span>
              {job.order.provider} · {job.order.mode} · target{" "}
              {job.order.targetDeviceId.slice(0, 10)}… · profile{" "}
              {job.order.targetProfileId.slice(0, 12)}… · {job.status}
            </span>
            <small>
              {job.order.handoff
                ? `${job.order.handoff.kind === "git_bundle" ? "Git bundle" : "Patch bundle"} · ${job.order.handoff.repositoryName} · base ${job.order.handoff.baseCommit?.slice(0, 12) ?? "not supplied"}…`
                : "Target repository only · no controller source handoff"}
              {job.order.providerVersion
                ? ` · ${job.order.providerVersion} · target provider default model`
                : " · target provider default model"}
              {` · controller ${job.order.controllerRoot}`}
            </small>
            {job.resultSummary && <p>{job.resultSummary}</p>}
            {job.resultArtifact && (
              <details open={applyCandidateJobId === job.order.jobId}>
                <summary>
                  {job.resultArtifact.status.length} returned change
                  {job.resultArtifact.status.length === 1 ? "" : "s"}
                </summary>
                {job.resultArtifact.status.length ? (
                  <ul>
                    {job.resultArtifact.status.slice(0, 200).map((entry) => (
                      <li key={entry}><code>{entry}</code></li>
                    ))}
                  </ul>
                ) : (
                  <p>The target worktree is clean.</p>
                )}
                <small>
                  Patch {job.resultArtifact.patchSha256.slice(0, 12)}… · base{" "}
                  {job.resultArtifact.baseCommit.slice(0, 12)}…
                </small>
              </details>
            )}
            <div className="device-fleet-result-actions">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void window.waypoint
                    .deviceNetworkWorkStatus(
                      job.order.targetDeviceId,
                      job.order.jobId,
                    )
                    .then(() => refreshFleetWork())
                    .catch(reportFleetFailure)
                }
              >
                Refresh status
              </button>
              {["queued", "waiting_approval", "running"].includes(job.status) && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void window.waypoint
                      .cancelDeviceNetworkWork(
                        job.order.targetDeviceId,
                        job.order.jobId,
                      )
                      .then(() => refreshFleetWork())
                      .catch(reportFleetFailure)
                  }
                >
                  Cancel
                </button>
              )}
              {job.status === "completed" &&
                job.resultArtifact &&
                job.order.handoff &&
                sameRepository(repositoryBoundary, job.order.controllerRoot) &&
                applyCandidateJobId !== job.order.jobId && (
                <button
                  type="button"
                  onClick={() => setApplyCandidateJobId(job.order.jobId)}
                >
                  Review returned changes
                </button>
              )}
              {applyCandidateJobId === job.order.jobId &&
                job.resultArtifact &&
                repositoryBoundary &&
                sameRepository(repositoryBoundary, job.order.controllerRoot) && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void window.waypoint
                          .applyDeviceNetworkWorkResult(
                            job.order.targetDeviceId,
                            job.order.jobId,
                            repositoryBoundary,
                          )
                          .then(() => {
                            setApplyCandidateJobId(undefined);
                            return refreshFleetWork();
                          })
                          .catch((reason) =>
                            setFleetSearchError(
                              reason instanceof Error
                                ? reason.message
                                : String(reason),
                            ),
                          )
                      }
                    >
                      Apply to {repositoryBoundary}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setApplyCandidateJobId(undefined)}
                    >
                      Retain on target
                    </button>
                  </>
                )}
              {job.worktreePath && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void window.waypoint
                      .discardDeviceNetworkWork(
                        job.order.targetDeviceId,
                        job.order.jobId,
                      )
                      .then(() => refreshFleetWork())
                      .catch(reportFleetFailure)
                  }
                >
                  Discard isolated worktree
                </button>
              )}
            </div>
          </article>
        ))}
        {!controllerWork.length &&
          !localWork.some((job) =>
            ["waiting_approval", "queued", "running"].includes(job.status),
          ) && (
          <p>No fleet work is waiting or tracked on this device.</p>
        )}
      </section>

      <section className="device-peer-section">
        <header>
          <div>
            <p className="device-network-kicker">Instances on this LAN</p>
            <h3>Device Network</h3>
          </div>
          <span>{network.peers.length} visible or trusted</span>
        </header>
        {!network.peers.length && (
          <div className="device-network-empty">
            <strong>No other Waypoint instances yet</strong>
            <p>
              Start Waypoint on another computer connected to this local
              network. It will appear here automatically—there is no invite code
              to paste.
            </p>
          </div>
        )}
        <div className="device-peer-grid">
          {network.peers.map((peer) => (
            <DeviceCard
              key={peer.deviceId}
              peer={peer}
              localVersion={network.local.metadata.appVersion}
              busy={isDevicePeerBusy(busy, peer)}
              onRequestPairing={onRequestPairing}
              onConfirmPairing={onConfirmPairing}
              onUnlink={onUnlink}
              onMode={onMode}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function Preference({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="device-preference">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function DeviceCard({
  peer,
  localVersion,
  busy,
  onRequestPairing,
  onConfirmPairing,
  onUnlink,
  onMode,
}: {
  peer: Peer;
  localVersion: string;
  busy: boolean;
  onRequestPairing(deviceId: string): void;
  onConfirmPairing(sessionId: string): void;
  onUnlink(deviceId: string, displayName: string): void;
  onMode(deviceId: string, mode: "supervised" | "autonomous"): void;
}) {
  const incompatible = peer.appVersion !== localVersion;
  return (
    <article className={`device-peer-card ${peer.status}`}>
      <header>
        <div className="device-platform-glyph" aria-hidden="true">
          {peer.platform === "darwin"
            ? "⌘"
            : peer.platform === "win32"
              ? "⊞"
              : "◇"}
        </div>
        <div>
          <h4>{peer.displayName}</h4>
          <p>
            {peer.platform} · {peer.architecture}
          </p>
        </div>
        <span className={`device-status-badge ${peer.status}`}>
          {statusLabels[peer.status]}
        </span>
      </header>
      <div className="device-card-meta">
        <span>Waypoint {peer.appVersion}</span>
        {incompatible && (
          <span className="version-warning">Version differs</span>
        )}
        {peer.lastSeenAt && (
          <span>Seen {new Date(peer.lastSeenAt).toLocaleTimeString()}</span>
        )}
        {peer.catalogWorkspaceCount !== undefined && (
          <span>
            {peer.catalogWorkspaceCount} workspace
            {peer.catalogWorkspaceCount === 1 ? "" : "s"} cataloged
          </span>
        )}
      </div>
      <div className="device-capability-state" aria-label="Device capabilities">
        <span className="device-capability-label">Available</span>
        {(peer.capabilities.length
          ? peer.capabilities
          : ["Capabilities unavailable"]
        ).map((capability) => (
          <span className="device-capability" key={capability}>
            {capabilityLabels[capability] ?? capability}
          </span>
        ))}
      </div>
      {(peer.pauseWork ||
        peer.pauseSync ||
        peer.runningJobs > 0 ||
        peer.attentionItems > 0) && (
        <div className="device-live-state" aria-label="Device activity">
          {peer.pauseWork && <span>Remote work paused</span>}
          {peer.pauseSync && <span>Sync paused</span>}
          {peer.runningJobs > 0 && (
            <span>
              {peer.runningJobs} running job
              {peer.runningJobs === 1 ? "" : "s"}
            </span>
          )}
          {peer.attentionItems > 0 && (
            <span>
              {peer.attentionItems} item
              {peer.attentionItems === 1 ? "" : "s"} need attention
            </span>
          )}
        </div>
      )}
      {peer.pairing && (
        <div className="pairing-ceremony">
          <p>Confirm that this same code is visible on both devices.</p>
          <strong aria-label={`Pairing code ${peer.pairing.code}`}>
            {peer.pairing.code.slice(0, 3)} {peer.pairing.code.slice(3)}
          </strong>
          <small>
            {peer.pairing.localConfirmed
              ? "Confirmed here. Waiting for the other device."
              : "Nothing is linked until both devices confirm."}
          </small>
          <button
            type="button"
            disabled={busy || peer.pairing.localConfirmed}
            onClick={() => onConfirmPairing(peer.pairing!.sessionId)}
          >
            {peer.pairing.localConfirmed ? "Waiting…" : "Codes match · link"}
          </button>
        </div>
      )}
      <div className="device-card-actions">
        {!peer.trusted && !peer.pairing && peer.status === "unlinked" && (
          <button
            type="button"
            disabled={busy || incompatible}
            onClick={() => onRequestPairing(peer.deviceId)}
          >
            {incompatible ? "Update Waypoint to link" : "Link this device"}
          </button>
        )}
        {peer.trusted && (
          <>
            <label>
              Default
              <select
                value={peer.defaultMode}
                disabled={busy}
                onChange={(event) =>
                  onMode(
                    peer.deviceId,
                    event.target.value as "supervised" | "autonomous",
                  )
                }
              >
                <option value="supervised">Supervised</option>
                <option value="autonomous">Autonomous</option>
              </select>
            </label>
            <button
              type="button"
              className="unlink-device"
              disabled={busy}
              onClick={() => onUnlink(peer.deviceId, peer.displayName)}
            >
              Unlink
            </button>
          </>
        )}
      </div>
      {peer.status === "identity-conflict" && (
        <p className="device-security-warning">
          Waypoint saw two different public keys claim this device ID. Linking
          is blocked. Quit both instances and inspect the duplicate
          installation.
        </p>
      )}
    </article>
  );
}
