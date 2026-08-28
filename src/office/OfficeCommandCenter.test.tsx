import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AgentInspector,
  OfficeCommandCenter,
  type OfficeCommandCenterProps,
} from "./OfficeCommandCenter.js";
import type { OfficeAgent } from "./office-state.js";
import { targetRootOptionValue } from "./office-work-order.js";

const baseAgent: OfficeAgent = {
  id: "chat-1",
  chatId: "chat-1",
  title: "Build the office",
  provider: "codex",
  status: "working",
  statusLabel: "Working",
  objective: "Build the command center",
  runId: "run-1",
  canCancel: true,
  securityProfileId: "profile-1",
  authorityLabel: "Developer · workspace-write · approve writes",
  updatedAt: "2026-08-17T16:00:00Z",
};

const emptyProps: OfficeCommandCenterProps = {
  workspaceName: "Empty",
  repositoryBoundary: "D:\\Repos\\Waypoint",
  providerOptions: [
    {
      id: "codex",
      label: "Codex",
      available: true,
      modelLabel: "Codex CLI default",
    },
  ],
  chats: [],
  runs: [],
  requests: [],
  sessions: [],
  profiles: [],
  onOpenChat: vi.fn(),
  onCancelRun: vi.fn(),
  onAuthorizeProfile: vi.fn(async () => true),
  onDispatchWorkOrder: vi.fn(async () => ({
    chatId: "chat-new",
    runId: "run-new",
    provider: "codex" as const,
    statusRefresh: "current" as const,
  })),
};

function buttonsIn(node: ReactNode): Array<Record<string, unknown>> {
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode } & Record<string, unknown>,
    nested = Array.isArray(props.children)
      ? props.children.flatMap(buttonsIn)
      : buttonsIn(props.children);
  return node.type === "button" ? [props, ...nested] : nested;
}

describe("OfficeCommandCenter", () => {
  it("keeps multiple roots from one target profile independently selectable", () => {
    expect(targetRootOptionValue("profile-1", "/repo/one")).not.toBe(
      targetRootOptionValue("profile-1", "/repo/two"),
    );
  });
  it("renders the manager, truthful floor occupant, and complete roster semantics", () => {
    const html = renderToStaticMarkup(
      createElement(OfficeCommandCenter, {
        ...emptyProps,
        workspaceName: "Waypoint QA",
        chats: [
          {
            id: "chat-1",
            title: "Build the office",
            updatedAt: "2026-08-17T16:00:00Z",
            messages: [
              {
                id: "message-1",
                role: "user",
                body: "Build the command center",
                createdAt: "2026-08-17T15:00:00Z",
              },
            ],
          },
        ],
        runs: [
          {
            id: "run-1",
            chatId: "chat-1",
            sourceMessageId: "message-1",
            cli: "codex",
            status: "running",
            securityProfileId: "profile-1",
          },
        ],
        profiles: [
          {
            id: "profile-1",
            name: "Developer",
            filesystem: "workspace-write",
            network: "provider-only",
            approval: "on-write",
          },
        ],
      }),
    );
    expect(html).toContain("Waypoint QA office");
    expect(html).toContain('aria-label="Select Office Manager"');
    expect(html).toContain('aria-label="Select Build the office, Working"');
    expect(html).toContain("Team roster");
    expect(html).toContain(
      "Every occupant and status below comes from a real Waypoint record.",
    );
  });

  it("renders an honest empty office", () => {
    const html = renderToStaticMarkup(
      createElement(OfficeCommandCenter, emptyProps),
    );
    expect(html).toContain("The office is quiet.");
    expect(html).toContain("Office Manager");
    expect(html).toContain("Begin a task");
  });
});

describe("AgentInspector", () => {
  it("routes every approval through the full detailed conversation", () => {
    const html = renderToStaticMarkup(
      createElement(AgentInspector, {
        agent: {
          ...baseAgent,
          status: "waiting",
          statusLabel: "Waiting for your decision",
          requestId: "request-1",
          requestKind: "permission",
          requestTitle: "Allow a file change",
        },
        busy: false,
        onOpenChat: vi.fn(),
        onCancelRun: vi.fn(),
      }),
    );
    expect(html).toContain("Review conversation");
    expect(html).toContain("exact request details");
    expect(html).not.toContain(">Deny<");
    expect(html).not.toContain("Approve once");
    expect(html).toContain("Stop work");
  });

  it("wires the visible open and cancel controls to their exact records", () => {
    const onOpenChat = vi.fn(),
      onCancelRun = vi.fn(),
      tree = AgentInspector({
        agent: {
          ...baseAgent,
          status: "waiting",
          statusLabel: "Waiting for your decision",
          requestId: "request-2",
          requestKind: "question",
          requestTitle: "Choose an implementation path",
        },
        busy: false,
        onOpenChat,
        onCancelRun,
      }),
      buttons = buttonsIn(tree),
      open = buttons.find((props) => props.children === "Review conversation"),
      stop = buttons.find((props) => props.children === "Stop work");
    expect(open).toBeDefined();
    expect(stop).toBeDefined();
    (open?.onClick as () => void)();
    (stop?.onClick as () => void)();
    expect(onOpenChat).toHaveBeenCalledWith("chat-1");
    expect(onCancelRun).toHaveBeenCalledWith("run-1");
  });
});
