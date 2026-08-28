import { useState, type FormEvent } from "react";
import type { FleetContextReference } from "./fleet-context";

type SearchResult = Awaited<
  ReturnType<Window["waypoint"]["searchDeviceNetwork"]>
>["results"][number];

export function FleetKnowledgePanel({
  localDeviceId,
  context,
  onSelect,
}: {
  localDeviceId?: string;
  context: "knowledge" | "office";
  onSelect?(reference: FleetContextReference): void;
}) {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState<
      Awaited<ReturnType<Window["waypoint"]["searchDeviceNetwork"]>>
    >(),
    [opened, setOpened] = useState<
      Awaited<ReturnType<Window["waypoint"]["openDeviceNetworkObject"]>>
    >(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    setOpened(undefined);
    try {
      setSearch(await window.waypoint.searchDeviceNetwork(value, 12));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function open(result: SearchResult) {
    setError("");
    try {
      setOpened(
        await window.waypoint.openDeviceNetworkObject({
          sourceDeviceId: result.sourceDeviceId,
          workspaceId: result.workspaceId,
          objectId: result.objectId,
          objectKind: result.objectKind,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <section
      className={`fleet-context-panel ${context}`}
      aria-label="Fleet knowledge"
    >
      <header>
        <div>
          <small>Trusted device context</small>
          <h3>Fleet knowledge</h3>
        </div>
        <span>Source device and workspace stay visible</span>
      </header>
      <form onSubmit={(event) => void submit(event)}>
        <input
          aria-label={`Search fleet knowledge from ${context}`}
          value={query}
          maxLength={500}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search local and trusted online workspaces"
        />
        <button type="submit" disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Search fleet"}
        </button>
      </form>
      {error && <p className="device-security-warning">{error}</p>}
      {search && (
        <div className="fleet-context-results" aria-live="polite">
          <p>
            {search.results.length} result
            {search.results.length === 1 ? "" : "s"}
            {search.partial
              ? ` · incomplete (${search.unavailableDeviceIds.length} trusted device unavailable)`
              : " · all trusted online devices answered"}
          </p>
          {search.results.map((result) => (
            <article
              key={`${result.sourceDeviceId}:${result.workspaceId}:${result.objectId}`}
            >
              <strong>{result.title || "Untitled"}</strong>
              <small>
                {result.workspaceName} · {result.objectKind} · device{" "}
                {result.sourceDeviceId.slice(0, 10)}…
              </small>
              <p>{result.excerpt}</p>
              <div>
                {result.sourceDeviceId === localDeviceId ? (
                  <span>Local result · open it from its workspace</span>
                ) : (
                  <button type="button" onClick={() => void open(result)}>
                    Open trusted copy
                  </button>
                )}
                {onSelect && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      onSelect({
                        sourceDeviceId: result.sourceDeviceId,
                        workspaceId: result.workspaceId,
                        workspaceName: result.workspaceName,
                        objectId: result.objectId,
                        objectKind: result.objectKind,
                        revisionId: result.revisionId,
                        title: result.title,
                        excerpt: result.excerpt,
                      })
                    }
                  >
                    Add to work order
                  </button>
                )}
              </div>
            </article>
          ))}
          {opened && (
            <article className="fleet-context-opened">
              <strong>
                {opened.cache.sourceOnline
                  ? "Refreshed from its source and cached encrypted"
                  : "Opened from encrypted offline cache"}
              </strong>
              <pre>{JSON.stringify(opened.object, null, 2)}</pre>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
