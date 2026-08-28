import type { OfficeProfileSource, OfficeProvider } from "./office-state.js";
import type { FleetContextReference } from "../device-network/fleet-context.js";

export type WorkOrderProvider = Exclude<OfficeProvider, "unassigned">;

export interface OfficeProviderOption {
  id: WorkOrderProvider;
  label: string;
  available: boolean;
  availabilityReason?: string;
  model?: string;
  modelLabel: string;
}

export interface OfficeWorkOrder {
  objective: string;
  provider: WorkOrderProvider;
  securityProfileId: string;
  model?: string;
  fleetContext?: FleetContextReference[];
  targetDeviceId?: string;
  targetDeviceName?: string;
  remoteMode?: "supervised" | "autonomous";
  targetRoot?: string;
  targetProfileId?: string;
  targetProviderVersion?: string;
  dispatchIdempotencyKey?: string;
}

export interface OfficeDispatchResult {
  chatId: string;
  runId: string;
  provider: WorkOrderProvider;
}

export interface OfficeManagerDispatchResult extends OfficeDispatchResult {
  statusRefresh: "current" | "delayed";
}

export interface OfficeDispatchApi {
  createChat(workspaceId: string, title: string): Promise<string>;
  addMessage(
    workspaceId: string,
    chatId: string,
    role: "user",
    body: string,
    attachmentIds: string[],
  ): Promise<string>;
  runLocal(input: {
    workspaceId: string;
    chatId: string;
    sourceMessageId: string;
    provider: Exclude<WorkOrderProvider, "openrouter">;
    securityProfileId: string;
    prompt: string;
    model?: string;
  }): Promise<{ runId: string }>;
  runHosted(input: {
    workspaceId: string;
    chatId: string;
    sourceMessageId: string;
    prompt: string;
    securityProfileId: string;
  }): Promise<{
    runId?: string;
    fallbackProvider?: "codex" | "claude" | "grok";
    reason?: string;
  }>;
}

export interface WorkOrderValidation {
  valid: boolean;
  errors: Partial<Record<"objective" | "provider" | "profile" | "repository" | "target", string>>;
  order?: OfficeWorkOrder;
}

export function targetRootOptionValue(profileId: string, root: string): string {
  return `${encodeURIComponent(profileId)}:${encodeURIComponent(root)}`;
}

export function validateOfficeWorkOrder(
  draft: OfficeWorkOrder,
  providers: OfficeProviderOption[],
  profiles: OfficeProfileSource[],
  repositoryBoundary: string,
): WorkOrderValidation {
  const errors: WorkOrderValidation["errors"] = {},
    objective = draft.objective.trim(),
    provider = providers.find((item) => item.id === draft.provider),
    profile = profiles.find((item) => item.id === draft.securityProfileId);
  if (!objective) errors.objective = "Describe the outcome you want.";
  else if (objective.length > 6_000)
    errors.objective = "Keep the work order under 6,000 characters.";
  if (!provider?.available)
    errors.provider =
      provider?.availabilityReason ?? "Choose an available provider.";
  if (!profile) errors.profile = "Choose an existing authority profile.";
  else if (draft.targetDeviceId && profile.filesystem !== "workspace-write")
    errors.profile =
      "Remote coding handoff requires a workspace-write controller authority profile.";
  if (draft.targetDeviceId && draft.provider === "openrouter")
    errors.target = "Remote work requires a target-local Codex, Claude, or Grok provider.";
  if (draft.targetDeviceId && (!draft.targetRoot || !draft.targetProfileId))
    errors.target =
      "Choose an authorized repository and authority profile on the target device.";
  if (!repositoryBoundary)
    errors.repository = "Select an agent repository in Settings first.";
  if (Object.keys(errors).length) return { valid: false, errors };
  return {
    valid: true,
    errors,
    order: {
      objective,
      provider: provider!.id,
      securityProfileId: profile!.id,
      model: provider!.model || undefined,
      ...(draft.fleetContext?.length
        ? {
            fleetContext: draft.fleetContext.slice(0, 8).map((item) => ({
              sourceDeviceId: item.sourceDeviceId,
              workspaceId: item.workspaceId,
              workspaceName: item.workspaceName.slice(0, 120),
              objectId: item.objectId,
              objectKind: item.objectKind.slice(0, 64),
              ...(item.revisionId
                ? { revisionId: item.revisionId.slice(0, 128) }
                : {}),
              title: item.title.slice(0, 300),
              excerpt: item.excerpt.slice(0, 500),
            })),
          }
        : {}),
      ...(draft.targetDeviceId
        ? {
            targetDeviceId: draft.targetDeviceId,
            targetDeviceName: draft.targetDeviceName,
            remoteMode: draft.remoteMode ?? "supervised",
            targetRoot: draft.targetRoot,
            targetProfileId: draft.targetProfileId,
            targetProviderVersion: draft.targetProviderVersion,
            dispatchIdempotencyKey: draft.dispatchIdempotencyKey,
          }
        : {}),
    },
  };
}

export function officeWorkOrderTitle(objective: string): string {
  const firstLine = objective.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, " ");
  return firstLine.slice(0, 80) || "Office work order";
}

export function officeWorkOrderPrompt(order: OfficeWorkOrder): string {
  if (!order.fleetContext?.length) return order.objective;
  return `${order.objective}\n\nTrusted fleet context (provenance retained; verify freshness before consequential use):\n${order.fleetContext
    .map(
      (item, index) =>
        `${index + 1}. ${item.title} [device=${item.sourceDeviceId}; workspace=${item.workspaceName} (${item.workspaceId}); ${item.objectKind}=${item.objectId}${item.revisionId ? `; revision=${item.revisionId}` : ""}]\n${item.excerpt}`,
    )
    .join("\n")}`;
}

export async function validateOfficeFleetContextForDispatch(
  api: {
    openDeviceNetworkObject(input: {
      sourceDeviceId: string;
      workspaceId: string;
      objectId: string;
      objectKind: string;
      requireFreshAuthorization?: boolean;
    }): Promise<{ object: unknown }>;
  },
  localDeviceId: string | undefined,
  references: FleetContextReference[],
): Promise<void> {
  for (const reference of references) {
    if (reference.sourceDeviceId === localDeviceId) continue;
    const opened = await api.openDeviceNetworkObject({
      sourceDeviceId: reference.sourceDeviceId,
      workspaceId: reference.workspaceId,
      objectId: reference.objectId,
      objectKind: reference.objectKind,
      requireFreshAuthorization: true,
    });
    if (
      reference.revisionId &&
      (opened.object as { revisionId?: unknown })?.revisionId !==
        reference.revisionId
    )
      throw new Error(
        `${reference.title} changed after it was selected. Search again before dispatching this work order.`,
      );
  }
}

export async function refreshAfterOfficeDispatch(
  refresh: () => Promise<void>,
): Promise<boolean> {
  try {
    await refresh();
    return true;
  } catch {
    return false;
  }
}

export async function dispatchOfficeWorkOrder(
  api: OfficeDispatchApi,
  workspaceId: string,
  order: OfficeWorkOrder,
): Promise<OfficeDispatchResult> {
  const prompt = officeWorkOrderPrompt(order),
    chatId = await api.createChat(
      workspaceId,
      officeWorkOrderTitle(order.objective),
    ),
    sourceMessageId = await api.addMessage(
      workspaceId,
      chatId,
      "user",
      prompt,
      [],
    );
  if (order.provider === "openrouter") {
    const hosted = await api.runHosted({
      workspaceId,
      chatId,
      sourceMessageId,
      prompt,
      securityProfileId: order.securityProfileId,
    });
    if (hosted.fallbackProvider)
      throw new Error(
        `OpenRouter could not start this work order. The confirmed provider was not changed and no ${hosted.fallbackProvider} fallback was started.${hosted.reason ? ` Provider detail: ${hosted.reason}` : ""}`,
      );
    if (!hosted.runId)
      throw new Error("OpenRouter did not return an execution identity.");
    return { chatId, runId: hosted.runId, provider: "openrouter" };
  }
  const started = await api.runLocal({
    workspaceId,
    chatId,
    sourceMessageId,
    provider: order.provider,
    securityProfileId: order.securityProfileId,
    prompt,
    model: order.model,
  });
  return { chatId, runId: started.runId, provider: order.provider };
}
