export type OfficeAgentStatus =
  | "working"
  | "waiting"
  | "delivered"
  | "failed"
  | "idle";

export type OfficeProvider =
  | "codex"
  | "claude"
  | "grok"
  | "openrouter"
  | "unassigned";

export interface OfficeChatSource {
  id: string;
  title: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: string;
    body: string;
    createdAt: string;
  }>;
}

export interface OfficeRequestSource {
  id: string;
  chatId: string;
  provider: OfficeProvider;
  executionId?: string;
  kind?: string;
  title: string;
  status: string;
  createdAt: string;
}

export interface OfficeSessionSource {
  chatId: string;
  provider: Exclude<OfficeProvider, "openrouter" | "unassigned">;
  securityProfileId: string;
  status: "active" | "stale" | "reset";
  updatedAt: string;
}

export interface OfficeProfileSource {
  id: string;
  name: string;
  filesystem: "read-only" | "workspace-write";
  network: "provider-only" | "disabled" | "enabled";
  approval: "always" | "on-write" | "never";
}

export interface OfficeAgent {
  id: string;
  chatId: string;
  title: string;
  provider: OfficeProvider;
  status: OfficeAgentStatus;
  statusLabel: string;
  objective: string;
  latestActivity?: string;
  runId?: string;
  canCancel: boolean;
  requestId?: string;
  requestKind?: string;
  requestTitle?: string;
  securityProfileId?: string;
  authorityLabel: string;
  updatedAt: string;
}

export interface BuildOfficeAgentsInput {
  chats: OfficeChatSource[];
  runs: Array<Record<string, unknown>>;
  requests: OfficeRequestSource[];
  sessions: OfficeSessionSource[];
  profiles: OfficeProfileSource[];
}

function timestamp(value: unknown): number {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function runTimestamp(run: Record<string, unknown>): number {
  return Math.max(
    timestamp(run.finishedAt),
    timestamp(run.updatedAt),
    timestamp(run.createdAt),
  );
}

function providerFrom(value: unknown): OfficeProvider {
  return ["codex", "claude", "grok", "openrouter"].includes(String(value))
    ? (String(value) as OfficeProvider)
    : "unassigned";
}

function latestRun(
  runs: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return runs.reduce<Record<string, unknown> | undefined>((latest, run) => {
    if (!latest) return run;
    return runTimestamp(run) >= runTimestamp(latest) ? run : latest;
  }, undefined);
}

function runForAgent(
  runs: Array<Record<string, unknown>>,
  request: OfficeRequestSource | undefined,
): Record<string, unknown> | undefined {
  const requested = request?.executionId
    ? runs.find((run) => String(run.id) === request.executionId)
    : undefined;
  if (requested) return requested;
  const active = runs.filter((run) =>
    ["queued", "running"].includes(String(run.status)),
  );
  return latestRun(active.length ? active : runs);
}

function latestActivity(run: Record<string, unknown> | undefined) {
  if (!run || !Array.isArray(run.events)) return undefined;
  const event = [...run.events]
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .sort(
      (left, right) =>
        timestamp(right.createdAt) - timestamp(left.createdAt) ||
        Number(right.sequence ?? 0) - Number(left.sequence ?? 0),
    )[0];
  if (!event) return undefined;
  const name = String(event.name ?? "").trim();
  const text = String(event.text ?? "").trim();
  const value = name || text;
  return /[\p{L}\p{N}]/u.test(value) ? value.slice(0, 180) : undefined;
}

function statusFor(
  run: Record<string, unknown> | undefined,
  request: OfficeRequestSource | undefined,
): Pick<OfficeAgent, "status" | "statusLabel"> {
  if (request)
    return { status: "waiting", statusLabel: "Waiting for your decision" };
  const status = String(run?.status ?? "");
  if (status === "running" || status === "queued")
    return { status: "working", statusLabel: "Working" };
  if (status === "completed")
    return { status: "delivered", statusLabel: "Ready for review" };
  if (["failed", "timed_out", "canceled"].includes(status))
    return {
      status: "failed",
      statusLabel:
        status === "canceled" ? "Canceled" : status.replace("_", " "),
    };
  return { status: "idle", statusLabel: "Available" };
}

function authorityLabel(
  profile: OfficeProfileSource | undefined,
  provider: OfficeProvider,
): string {
  if (!profile)
    return provider === "openrouter"
      ? "Historical hosted authority was not recorded"
      : "Authority unavailable";
  const approval =
    profile.approval === "never"
      ? "bypass approvals"
      : profile.approval === "always"
        ? "approval required"
        : "approve writes";
  return `${profile.name} · ${profile.filesystem} · ${approval}`;
}

export function buildOfficeAgents({
  chats,
  runs,
  requests,
  sessions,
  profiles,
}: BuildOfficeAgentsInput): OfficeAgent[] {
  return chats
    .map((chat) => {
      const chatRuns = runs.filter((run) => String(run.chatId) === chat.id),
        request = requests
          .filter((item) => item.chatId === chat.id && item.status === "pending")
          .sort(
            (left, right) =>
              timestamp(right.createdAt) - timestamp(left.createdAt),
          )[0],
        run = runForAgent(chatRuns, request),
        session = sessions
          .filter((item) => item.chatId === chat.id && item.status === "active")
          .sort(
            (left, right) =>
              timestamp(right.updatedAt) - timestamp(left.updatedAt),
          )[0],
        provider = providerFrom(run?.cli ?? request?.provider ?? session?.provider),
        securityProfileId = String(
          run?.securityProfileId ?? session?.securityProfileId ?? "",
        ) || undefined,
        profile = profiles.find((item) => item.id === securityProfileId),
        exactSource = run?.sourceMessageId
          ? chat.messages.find(
              (message) => message.id === String(run.sourceMessageId),
            )
          : undefined,
        latestUser = chat.messages
          .filter((message) => message.role === "user")
          .sort(
            (left, right) =>
              timestamp(right.createdAt) - timestamp(left.createdAt),
          )[0],
        objective =
          exactSource?.body.trim() ||
          latestUser?.body.trim() ||
          "No task brief yet",
        state = statusFor(run, request);
      return {
        id: chat.id,
        chatId: chat.id,
        title: chat.title,
        provider,
        ...state,
        objective,
        latestActivity: latestActivity(run),
        runId: run?.id ? String(run.id) : undefined,
        canCancel: ["queued", "running"].includes(String(run?.status ?? "")),
        requestId: request?.id,
        requestKind: request?.kind,
        requestTitle: request?.title,
        securityProfileId,
        authorityLabel: authorityLabel(profile, provider),
        updatedAt: String(
          run?.finishedAt ?? run?.updatedAt ?? chat.updatedAt ?? "",
        ),
      } satisfies OfficeAgent;
    })
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
}

const floorPriority: Record<OfficeAgentStatus, number> = {
  waiting: 0,
  working: 1,
  failed: 2,
  delivered: 3,
  idle: 4,
};

export function agentsForOfficeFloor(agents: OfficeAgent[], limit = 4) {
  return [...agents]
    .sort(
      (left, right) =>
        floorPriority[left.status] - floorPriority[right.status] ||
        timestamp(right.updatedAt) - timestamp(left.updatedAt),
    )
    .slice(0, Math.max(0, limit));
}

export function officeStatusCounts(agents: OfficeAgent[]) {
  return agents.reduce(
    (counts, agent) => ({
      ...counts,
      [agent.status]: counts[agent.status] + 1,
    }),
    { working: 0, waiting: 0, delivered: 0, failed: 0, idle: 0 },
  );
}
