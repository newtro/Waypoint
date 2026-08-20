import type { OfficeProfileSource, OfficeProvider } from "./office-state.js";

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
  errors: Partial<Record<"objective" | "provider" | "profile" | "repository", string>>;
  order?: OfficeWorkOrder;
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
    },
  };
}

export function officeWorkOrderTitle(objective: string): string {
  const firstLine = objective.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, " ");
  return firstLine.slice(0, 80) || "Office work order";
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
  const chatId = await api.createChat(
      workspaceId,
      officeWorkOrderTitle(order.objective),
    ),
    sourceMessageId = await api.addMessage(
      workspaceId,
      chatId,
      "user",
      order.objective,
      [],
    );
  if (order.provider === "openrouter") {
    const hosted = await api.runHosted({
      workspaceId,
      chatId,
      sourceMessageId,
      prompt: order.objective,
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
    prompt: order.objective,
    model: order.model,
  });
  return { chatId, runId: started.runId, provider: order.provider };
}
