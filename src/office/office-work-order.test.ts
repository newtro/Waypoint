import { describe, expect, it, vi } from "vitest";
import {
  dispatchOfficeWorkOrder,
  officeWorkOrderTitle,
  refreshAfterOfficeDispatch,
  validateOfficeFleetContextForDispatch,
  validateOfficeWorkOrder,
  type OfficeDispatchApi,
  type OfficeProviderOption,
  type OfficeWorkOrder,
} from "./office-work-order.js";

const providers: OfficeProviderOption[] = [
  {
    id: "codex",
    label: "Codex",
    available: true,
    model: "gpt-test",
    modelLabel: "gpt-test",
  },
  {
    id: "claude",
    label: "Claude",
    available: false,
    availabilityReason: "Claude is not signed in.",
    modelLabel: "Claude CLI default",
  },
];
const profiles = [
  {
    id: "profile-1",
    name: "Developer",
    filesystem: "workspace-write" as const,
    network: "provider-only" as const,
    approval: "on-write" as const,
  },
];

function api() {
  return {
    createChat: vi.fn(async () => "chat-1"),
    addMessage: vi.fn(async () => "message-1"),
    runLocal: vi.fn(async () => ({ runId: "run-local" })),
    runHosted: vi.fn(
      async (): Promise<
        Awaited<ReturnType<OfficeDispatchApi["runHosted"]>>
      > => ({ runId: "run-hosted" }),
    ),
  } satisfies OfficeDispatchApi;
}

describe("Office Manager work orders", () => {
  it("requires a bounded objective, available provider, profile, and repository", () => {
    const invalid = validateOfficeWorkOrder(
      {
        objective: "  ",
        provider: "claude",
        securityProfileId: "missing",
      },
      providers,
      profiles,
      "",
    );
    expect(invalid).toMatchObject({
      valid: false,
      errors: {
        objective: "Describe the outcome you want.",
        provider: "Claude is not signed in.",
        profile: "Choose an existing authority profile.",
        repository: "Select an agent repository in Settings first.",
      },
    });
  });

  it("normalizes only outer whitespace and binds the selected model", () => {
    expect(
      validateOfficeWorkOrder(
        {
          objective: "  Build exactly this\nwith this constraint.  ",
          provider: "codex",
          securityProfileId: "profile-1",
        },
        providers,
        profiles,
        "D:\\Repos\\Waypoint",
      ).order,
    ).toEqual({
      objective: "Build exactly this\nwith this constraint.",
      provider: "codex",
      securityProfileId: "profile-1",
      model: "gpt-test",
    });
    expect(officeWorkOrderTitle("  Build exactly this\nMore detail")).toBe(
      "Build exactly this",
    );
  });

  it("requires an authorized target root and target-local provider for remote work", () => {
    expect(
      validateOfficeWorkOrder(
        {
          objective: "Run this on the Mac",
          provider: "openrouter",
          securityProfileId: "profile-1",
          targetDeviceId: "target_device_0000001",
          targetRoot: "/Users/scott/Waypoint",
          targetProfileId: "profile_remote_0001",
        },
        [
          ...providers,
          {
            id: "openrouter",
            label: "OpenRouter",
            available: true,
            modelLabel: "Hosted",
          },
        ],
        profiles,
        "D:\\Repos\\Waypoint",
      ).errors.target,
    ).toMatch(/target-local/);
    expect(
      validateOfficeWorkOrder(
        {
          objective: "Run this on the Mac",
          provider: "codex",
          securityProfileId: "profile-1",
          targetDeviceId: "target_device_0000001",
          targetDeviceName: "Studio Mac",
          targetRoot: "/Users/scott/Waypoint",
          targetProfileId: "profile_remote_0001",
          remoteMode: "autonomous",
        },
        providers,
        profiles,
        "D:\\Repos\\Waypoint",
      ).order,
    ).toMatchObject({
      targetDeviceId: "target_device_0000001",
      targetDeviceName: "Studio Mac",
      targetRoot: "/Users/scott/Waypoint",
      targetProfileId: "profile_remote_0001",
      remoteMode: "autonomous",
    });
  });

  it("creates one real chat and dispatches the exact local payload once", async () => {
    const bridge = api(),
      order: OfficeWorkOrder = {
        objective: "Build exactly this",
        provider: "codex",
        securityProfileId: "profile-1",
        model: "gpt-test",
      };
    await expect(
      dispatchOfficeWorkOrder(bridge, "workspace-1", order),
    ).resolves.toEqual({
      chatId: "chat-1",
      runId: "run-local",
      provider: "codex",
    });
    expect(bridge.createChat).toHaveBeenCalledTimes(1);
    expect(bridge.addMessage).toHaveBeenCalledWith(
      "workspace-1",
      "chat-1",
      "user",
      "Build exactly this",
      [],
    );
    expect(bridge.runLocal).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      chatId: "chat-1",
      sourceMessageId: "message-1",
      provider: "codex",
      securityProfileId: "profile-1",
      prompt: "Build exactly this",
      model: "gpt-test",
    });
    expect(bridge.runHosted).not.toHaveBeenCalled();
  });

  it("binds selected fleet provenance into the audited message and agent prompt", async () => {
    const bridge = api(),
      order: OfficeWorkOrder = {
        objective: "Compare the remote decision",
        provider: "codex",
        securityProfileId: "profile-1",
        fleetContext: [
          {
            sourceDeviceId: "source_device_0001",
            workspaceId: "workspace_remote_0001",
            workspaceName: "Mac research",
            objectId: "memory_remote_000001",
            objectKind: "memory",
            revisionId: "revision_remote_0001",
            title: "Remote decision",
            excerpt: "Use the signed local transport.",
          },
        ],
      };
    await dispatchOfficeWorkOrder(bridge, "workspace-1", order);
    const prompt = expect.stringContaining(
      "device=source_device_0001; workspace=Mac research (workspace_remote_0001); memory=memory_remote_000001; revision=revision_remote_0001",
    );
    expect(bridge.addMessage).toHaveBeenCalledWith(
      "workspace-1",
      "chat-1",
      "user",
      prompt,
      [],
    );
    expect(bridge.runLocal).toHaveBeenCalledWith(
      expect.objectContaining({ prompt }),
    );
  });

  it("reauthorizes remote fleet context and rejects a changed revision", async () => {
    const reference = {
        sourceDeviceId: "source_device_0001",
        workspaceId: "workspace_remote_0001",
        workspaceName: "Mac research",
        objectId: "document_remote_0001",
        objectKind: "document",
        revisionId: "revision_remote_0001",
        title: "Remote decision",
        excerpt: "Earlier decision",
      },
      openDeviceNetworkObject = vi.fn(async () => ({
        object: { revisionId: "revision_remote_0002" },
      }));
    await expect(
      validateOfficeFleetContextForDispatch(
        { openDeviceNetworkObject },
        "local_device_000001",
        [reference],
      ),
    ).rejects.toThrow(/changed after it was selected/);
    expect(openDeviceNetworkObject).toHaveBeenCalledWith({
      sourceDeviceId: reference.sourceDeviceId,
      workspaceId: reference.workspaceId,
      objectId: reference.objectId,
      objectKind: reference.objectKind,
      requireFreshAuthorization: true,
    });

    openDeviceNetworkObject.mockRejectedValueOnce(
      new Error("Fleet source is no longer actively trusted"),
    );
    await expect(
      validateOfficeFleetContextForDispatch(
        { openDeviceNetworkObject },
        "local_device_000001",
        [reference],
      ),
    ).rejects.toThrow(/no longer actively trusted/);
  });

  it("dispatches hosted work without silently accepting a provider fallback", async () => {
    const bridge = api();
    await expect(
      dispatchOfficeWorkOrder(bridge, "workspace-1", {
        objective: "Hosted task",
        provider: "openrouter",
        securityProfileId: "profile-1",
      }),
    ).resolves.toMatchObject({ runId: "run-hosted", provider: "openrouter" });
    expect(bridge.runLocal).not.toHaveBeenCalled();

    bridge.runHosted.mockResolvedValueOnce({
      fallbackProvider: "codex",
      reason: "Hosted cap reached.",
    });
    await expect(
      dispatchOfficeWorkOrder(bridge, "workspace-1", {
        objective: "Do not reroute",
        provider: "openrouter",
        securityProfileId: "profile-1",
      }),
    ).rejects.toThrow(
      "The confirmed provider was not changed and no codex fallback was started",
    );
    expect(bridge.runLocal).not.toHaveBeenCalled();
  });

  it("treats a post-dispatch refresh failure as delayed status, not failed work", async () => {
    await expect(
      refreshAfterOfficeDispatch(async () => {
        throw new Error("temporary refresh failure");
      }),
    ).resolves.toBe(false);
    await expect(
      refreshAfterOfficeDispatch(async () => undefined),
    ).resolves.toBe(true);
  });
});
