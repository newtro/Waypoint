import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OfficeCommandCenter } from "../../src/office/OfficeCommandCenter";
import type { OfficeWorkOrder } from "../../src/office/office-work-order";

document.documentElement.dataset.theme =
  localStorage.getItem("waypoint.appearance.v1") === "light" ? "light" : "dark";

const profile = {
  id: "profile-1",
  name: "Developer",
  filesystem: "workspace-write" as const,
  network: "provider-only" as const,
  approval: "on-write" as const,
},
  bypassProfile = {
    ...profile,
    id: "profile-bypass",
    name: "Bypass permissions",
    approval: "never" as const,
};

export function Fixture() {
  const [chats, setChats] = useState([
      {
        id: "chat-existing",
        title: "Existing worker",
        updatedAt: "2026-08-17T16:00:00Z",
        messages: [
          {
            id: "message-existing",
            role: "user",
            body: "Inspect the existing task",
            createdAt: "2026-08-17T16:00:00Z",
          },
        ],
      },
    ]),
    [runs, setRuns] = useState<Array<Record<string, unknown>>>([
      {
        id: "run-existing",
        chatId: "chat-existing",
        sourceMessageId: "message-existing",
        cli: "codex",
        status: "running",
        securityProfileId: profile.id,
        createdAt: "2026-08-17T16:00:00Z",
      },
    ]),
    [dispatchCount, setDispatchCount] = useState(0),
    [dispatchAttempts, setDispatchAttempts] = useState(0),
    [authorizationCount, setAuthorizationCount] = useState(0);

  async function dispatch(order: OfficeWorkOrder) {
    setDispatchAttempts((count) => count + 1);
    if (order.objective === "FAIL_DISPATCH")
      throw new Error("Fixture dispatch rejected safely");
    setDispatchCount((count) => count + 1);
    if (order.objective === "DELAYED_REFRESH")
      return {
        chatId: "chat-delayed",
        runId: "run-delayed",
        provider: order.provider,
        statusRefresh: "delayed" as const,
      };
    setChats((current) => [
      {
        id: "chat-new",
        title: "Browser work order",
        updatedAt: "2026-08-17T16:05:00Z",
        messages: [
          {
            id: "message-new",
            role: "user",
            body: order.objective,
            createdAt: "2026-08-17T16:05:00Z",
          },
        ],
      },
      ...current,
    ]);
    setRuns((current) => [
      {
        id: "run-new",
        chatId: "chat-new",
        sourceMessageId: "message-new",
        cli: order.provider,
        status: "running",
        securityProfileId: order.securityProfileId,
        createdAt: "2026-08-17T16:05:00Z",
      },
      ...current,
    ]);
    return {
      chatId: "chat-new",
      runId: "run-new",
      provider: order.provider,
      statusRefresh: "current" as const,
    };
  }

  return (
    <>
      <output id="dispatch-count">{dispatchCount}</output>
      <output id="dispatch-attempts">{dispatchAttempts}</output>
      <output id="authorization-count">{authorizationCount}</output>
      <OfficeCommandCenter
        workspaceName="Browser proof"
        repositoryBoundary="D:\Repos\Waypoint"
        providerOptions={[
          {
            id: "codex",
            label: "Codex",
            available: true,
            model: "gpt-test",
            modelLabel: "gpt-test",
          },
        ]}
        chats={chats}
        runs={runs}
        requests={[]}
        sessions={[]}
        profiles={[profile, bypassProfile]}
        onOpenChat={() => undefined}
        onCancelRun={() => {
          throw new Error("Cancel failed safely");
        }}
        onAuthorizeProfile={async (profileId) => {
          if (profileId !== bypassProfile.id) return true;
          setAuthorizationCount((count) => count + 1);
          return authorizationCount > 0;
        }}
        onDispatchWorkOrder={dispatch}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
