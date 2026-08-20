import { describe, expect, it } from "vitest";
import {
  agentsForOfficeFloor,
  buildOfficeAgents,
  officeStatusCounts,
} from "./office-state.js";

const chats = [
  {
    id: "chat-1",
    title: "Ship the command center",
    updatedAt: "2026-08-17T14:00:00Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        body: "Build the office",
        createdAt: "2026-08-17T13:00:00Z",
      },
    ],
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

describe("office state", () => {
  it("maps a running execution to a truthful working agent", () => {
    const agents = buildOfficeAgents({
      chats,
      runs: [
        {
          id: "run-1",
          chatId: "chat-1",
          cli: "codex",
          status: "running",
          securityProfileId: "profile-1",
          createdAt: "2026-08-17T14:01:00Z",
          events: [
            {
              type: "tool",
              name: "Read files",
              sequence: 2,
              createdAt: "2026-08-17T14:02:00Z",
            },
          ],
        },
      ],
      requests: [],
      sessions: [],
      profiles,
    });
    expect(agents[0]).toMatchObject({
      provider: "codex",
      status: "working",
      statusLabel: "Working",
      canCancel: true,
      objective: "Build the office",
      latestActivity: "Read files",
      authorityLabel: "Developer · workspace-write · approve writes",
    });
  });

  it("gives a pending decision precedence over a running execution", () => {
    const [agent] = buildOfficeAgents({
      chats,
      runs: [
        {
          id: "run-1",
          chatId: "chat-1",
          cli: "claude",
          status: "running",
        },
      ],
      requests: [
        {
          id: "request-1",
          chatId: "chat-1",
          provider: "claude",
          title: "Allow file change",
          status: "pending",
          createdAt: "2026-08-17T14:03:00Z",
        },
      ],
      sessions: [],
      profiles: [],
    });
    expect(agent).toMatchObject({
      provider: "claude",
      status: "waiting",
      requestId: "request-1",
      canCancel: true,
      statusLabel: "Waiting for your decision",
    });
  });

  it("uses only the latest run and preserves explicit terminal states", () => {
    const [agent] = buildOfficeAgents({
      chats,
      runs: [
        {
          id: "old",
          chatId: "chat-1",
          cli: "codex",
          status: "completed",
          finishedAt: "2026-08-17T13:00:00Z",
        },
        {
          id: "new",
          chatId: "chat-1",
          cli: "grok",
          status: "failed",
          finishedAt: "2026-08-17T15:00:00Z",
        },
      ],
      requests: [],
      sessions: [],
      profiles: [],
    });
    expect(agent).toMatchObject({
      runId: "new",
      provider: "grok",
      status: "failed",
      statusLabel: "failed",
    });
  });

  it("keeps an active run visible over newer terminal history", () => {
    const [agent] = buildOfficeAgents({
      chats,
      runs: [
        {
          id: "active",
          chatId: "chat-1",
          cli: "codex",
          status: "running",
          createdAt: "2026-08-17T13:00:00Z",
        },
        {
          id: "newer-terminal",
          chatId: "chat-1",
          cli: "grok",
          status: "completed",
          finishedAt: "2026-08-17T15:00:00Z",
        },
      ],
      requests: [],
      sessions: [],
      profiles: [],
    });
    expect(agent).toMatchObject({
      runId: "active",
      provider: "codex",
      status: "working",
    });
  });

  it("uses the pending request execution and its exact source message", () => {
    const [agent] = buildOfficeAgents({
      chats: [
        {
          ...chats[0],
          messages: [
            ...chats[0].messages,
            {
              id: "message-2",
              role: "user",
              body: "Use the revised acceptance criteria",
              createdAt: "2026-08-17T14:02:00Z",
            },
          ],
        },
      ],
      runs: [
        {
          id: "run-requested",
          chatId: "chat-1",
          cli: "claude",
          status: "running",
          sourceMessageId: "message-2",
          createdAt: "2026-08-17T14:03:00Z",
        },
        {
          id: "run-other",
          chatId: "chat-1",
          cli: "grok",
          status: "running",
          sourceMessageId: "message-1",
          createdAt: "2026-08-17T14:04:00Z",
        },
      ],
      requests: [
        {
          id: "request-2",
          chatId: "chat-1",
          executionId: "run-requested",
          provider: "claude",
          title: "Approve write",
          status: "pending",
          createdAt: "2026-08-17T14:05:00Z",
        },
      ],
      sessions: [],
      profiles: [],
    });
    expect(agent).toMatchObject({
      runId: "run-requested",
      provider: "claude",
      status: "waiting",
      objective: "Use the revised acceptance criteria",
    });
  });

  it("maps completed work to delivery and accepts an empty office", () => {
    const delivered = buildOfficeAgents({
      chats,
      runs: [
        {
          id: "done",
          chatId: "chat-1",
          cli: "codex",
          status: "completed",
        },
      ],
      requests: [],
      sessions: [],
      profiles: [],
    });
    expect(delivered[0]).toMatchObject({
      status: "delivered",
      statusLabel: "Ready for review",
    });
    expect(
      buildOfficeAgents({
        chats: [],
        runs: [],
        requests: [],
        sessions: [],
        profiles: [],
      }),
    ).toEqual([]);
  });

  it("seats urgent agents before recent historical conversations", () => {
    const agents = [
      { id: "idle", status: "idle", updatedAt: "2026-08-17T16:00:00Z" },
      {
        id: "delivered",
        status: "delivered",
        updatedAt: "2026-08-17T15:00:00Z",
      },
      {
        id: "working",
        status: "working",
        updatedAt: "2026-08-17T14:00:00Z",
      },
      {
        id: "waiting",
        status: "waiting",
        updatedAt: "2026-08-17T13:00:00Z",
      },
    ] as ReturnType<typeof buildOfficeAgents>;
    expect(agentsForOfficeFloor(agents, 3).map((agent) => agent.id)).toEqual([
      "waiting",
      "working",
      "delivered",
    ]);
  });

  it("keeps a chat with no execution visibly idle instead of inventing work", () => {
    const agents = buildOfficeAgents({
      chats,
      runs: [],
      requests: [],
      sessions: [],
      profiles: [],
    });
    expect(agents[0]).toMatchObject({
      provider: "unassigned",
      status: "idle",
      statusLabel: "Available",
      latestActivity: undefined,
    });
    expect(officeStatusCounts(agents)).toEqual({
      working: 0,
      waiting: 0,
      delivered: 0,
      failed: 0,
      idle: 1,
    });
  });

  it("ignores punctuation-only provider events instead of showing noise", () => {
    const [agent] = buildOfficeAgents({
      chats,
      runs: [
        {
          id: "run-noise",
          chatId: "chat-1",
          cli: "codex",
          status: "completed",
          events: [{ type: "text", text: ".", sequence: 1 }],
        },
      ],
      requests: [],
      sessions: [],
      profiles: [],
    });
    expect(agent.latestActivity).toBeUndefined();
  });

  it("shows a recorded hosted authority and labels older hosted provenance honestly", () => {
    const current = buildOfficeAgents({
        chats,
        runs: [
          {
            id: "hosted-current",
            chatId: "chat-1",
            cli: "openrouter",
            status: "running",
            securityProfileId: "profile-1",
          },
        ],
        requests: [],
        sessions: [],
        profiles,
      })[0],
      historical = buildOfficeAgents({
        chats,
        runs: [
          {
            id: "hosted-old",
            chatId: "chat-1",
            cli: "openrouter",
            status: "completed",
          },
        ],
        requests: [],
        sessions: [],
        profiles,
      })[0];
    expect(current.authorityLabel).toBe(
      "Developer · workspace-write · approve writes",
    );
    expect(historical.authorityLabel).toBe(
      "Historical hosted authority was not recorded",
    );
  });
});
