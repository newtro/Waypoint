import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./store.js";

function preparedRuntime() {
  const root = mkdtempSync(path.join(tmpdir(), "waypoint-automation-")),
    store = new WorkspaceStore(path.join(root, "waypoint.sqlite")),
    workspace = store.createWorkspace("Automation", root),
    profile = store.listSecurityProfiles(workspace.id)[0],
    definition = {
      version: 1,
      title: "Review build",
      trigger: {
        connectorId: "azure_devops",
        eventType: "azure_devops.git.pullrequest.created",
        filters: { result: "ok" },
      },
      action: {
        kind: "ai_prompt",
        provider: "codex",
        securityProfileId: profile.id,
        instruction: "Review this build",
      },
      delivery: {
        channelId: "automation_channel_0001",
        endpoint: "https://relay.example/v1/hooks/automation_channel_0001",
        reachability: "public_relay",
      },
      provisioning: {
        mode: "az_devops_invoke",
        organization: "https://dev.azure.com/example",
        project: "SCV2",
        repository: "SCV2",
        projectId: "project-id",
        repositoryId: "repository-id",
      },
    } as const,
    proposal = store.createAutomationProposal(
      workspace.id,
      undefined,
      definition,
    );
  store.decideAutomationProposal(
    workspace.id,
    proposal.id,
    proposal.proposalDigest,
    "approve",
  );
  store.beginAutomationProvisioning(
    workspace.id,
    proposal.id,
    proposal.proposalDigest,
  );
  store.finishAutomationProvisioning(
    workspace.id,
    proposal.id,
    proposal.proposalDigest,
    {
      status: "applied",
      summary: "Sender ready",
      delivery: {
        channelId: definition.delivery.channelId,
        endpoint: definition.delivery.endpoint,
        reachability: definition.delivery.reachability,
      },
    },
  );
  const timestamp = new Date().toISOString();
  store.importExternalInboundEvent(workspace.id, {
    eventId: "delivery.00000001",
    channelId: "automation_channel_0001",
    connectorId: "azure_devops",
    eventType: "azure_devops.git.pullrequest.created",
    occurredAt: timestamp,
    receivedAt: timestamp,
    payload: { result: "ok" },
  });
  return { store, workspace, proposal };
}

describe("durable webhook automation runtime", () => {
  it("requires digest-bound approval, enables one exact rule, and queues an event once", () => {
    const { store, workspace, proposal } = preparedRuntime();
    expect(() =>
      store.decideAutomationProposal(
        workspace.id,
        proposal.id,
        "0".repeat(64),
        "approve",
      ),
    ).toThrow(/awaiting a decision/);
    expect(store.evaluateAutomationEvents(workspace.id)).toEqual({ queued: 1 });
    expect(store.evaluateAutomationEvents(workspace.id)).toEqual({ queued: 0 });
    const run = store.claimAutomationRun(workspace.id)!;
    expect(run.prompt).toContain("Review this build");
    store.finishAutomationRun(
      workspace.id,
      run.id,
      "completed",
      "Review completed",
    );
    expect(store.listAutomationRulesAndRuns(workspace.id)).toMatchObject({
      rules: [{ status: "enabled" }],
      runs: [{ status: "completed" }],
    });
    store.close();
  });

  it("stops rules, cancels queued work, and allows an explicit resume", () => {
    const { store, workspace } = preparedRuntime();
    store.evaluateAutomationEvents(workspace.id);
    const before = store.listAutomationRulesAndRuns(workspace.id),
      ruleId = String((before.rules[0] as Record<string, unknown>).id),
      runId = String(before.runs[0].id);
    store.cancelQueuedAutomationRun(workspace.id, runId);
    expect(
      store.listAutomationRulesAndRuns(workspace.id).runs[0],
    ).toMatchObject({
      status: "canceled",
      errorCode: "user_canceled",
    });
    store.setAutomationRuleStatus(workspace.id, ruleId, "killed");
    expect(
      (
        store.listAutomationRulesAndRuns(workspace.id).rules[0] as Record<
          string,
          unknown
        >
      ).status,
    ).toBe("killed");
    expect(store.evaluateAutomationEvents(workspace.id)).toEqual({ queued: 0 });
    store.setAutomationRuleStatus(workspace.id, ruleId, "enabled");
    expect(
      (
        store.listAutomationRulesAndRuns(workspace.id).rules[0] as Record<
          string,
          unknown
        >
      ).status,
    ).toBe("enabled");
    store.close();
  });

  it("refuses to re-enable a rule after its approved repository authority changes", () => {
    const { store, workspace } = preparedRuntime(),
      ruleId = String(
        (
          store.listAutomationRulesAndRuns(workspace.id).rules[0] as Record<
            string,
            unknown
          >
        ).id,
      ),
      replacement = mkdtempSync(
        path.join(tmpdir(), "waypoint-automation-replacement-"),
      );
    store.setAutomationRuleStatus(workspace.id, ruleId, "killed");
    store.setWorkspaceExecutionRoot(workspace.id, replacement);
    expect(() =>
      store.setAutomationRuleStatus(workspace.id, ruleId, "enabled"),
    ).toThrow(/repository authority changed/);
    expect(
      (
        store.listAutomationRulesAndRuns(workspace.id).rules[0] as Record<
          string,
          unknown
        >
      ).status,
    ).toBe("killed");
    store.close();
  });

  it("retains inbound events once durable automation run provenance exists", () => {
    const { store, workspace } = preparedRuntime(),
      event = store.listExternalInboundEvents(workspace.id)[0];
    store.evaluateAutomationEvents(workspace.id);
    expect(() =>
      store.deleteExternalInboundEvent(workspace.id, event.id),
    ).toThrow(/retained.*automation run \(queued\)/);
    const run = store.claimAutomationRun(workspace.id)!;
    expect(() =>
      store.deleteExternalInboundEvent(workspace.id, event.id),
    ).toThrow(/retained.*automation run \(running\)/);
    store.finishAutomationRun(
      workspace.id,
      run.id,
      "completed",
      "Review completed",
    );
    expect(() =>
      store.deleteExternalInboundEvent(workspace.id, event.id),
    ).toThrow(/retained.*automation run \(completed\)/);
    expect(store.listExternalInboundEvents(workspace.id)).toEqual([
      expect.objectContaining({ id: event.id }),
    ]);
    expect(store.listAutomationRulesAndRuns(workspace.id).runs).toEqual([
      expect.objectContaining({
        id: run.id,
        eventId: event.id,
        status: "completed",
      }),
    ]);
    store.close();
  });

  it("fails closed on receipt-digest tampering", () => {
    const { store, workspace } = preparedRuntime(),
      database = new DatabaseSync(store.databasePath);
    database
      .prepare(
        "UPDATE automation_approval_receipts SET proposal_digest=? WHERE workspace_id=?",
      )
      .run("0".repeat(64), workspace.id);
    database.close();
    expect(() => store.listAutomationProposals(workspace.id)).toThrow(
      /receipt digest/,
    );
    store.close();
  });

  it("fails closed when immutable decision or provisioning event bodies are forged", () => {
    const first = preparedRuntime(),
      decisionDatabase = new DatabaseSync(first.store.databasePath);
    decisionDatabase
      .prepare(
        "UPDATE automation_approval_receipts SET external_mutation_json=? WHERE workspace_id=?",
      )
      .run(
        '{"authorized":true,"executed":true,"externalId":"forged"}',
        first.workspace.id,
      );
    decisionDatabase.close();
    expect(() =>
      first.store.listAutomationProposals(first.workspace.id),
    ).toThrow(/receipt digest/);
    first.store.close();
    const second = preparedRuntime(),
      eventDatabase = new DatabaseSync(second.store.databasePath);
    eventDatabase
      .prepare(
        "UPDATE automation_provisioning_events SET payload_json=? WHERE workspace_id=? AND event_type='applied'",
      )
      .run('{"status":"applied","externalId":"forged"}', second.workspace.id);
    eventDatabase.close();
    expect(() =>
      second.store.listAutomationProposals(second.workspace.id),
    ).toThrow(/provisioning event digest/);
    second.store.close();
  });

  it("refuses runtime authority after receipt, terminal event, or enabled-rule tampering", () => {
    const missingReceipt = preparedRuntime(),
      receiptDb = new DatabaseSync(missingReceipt.store.databasePath);
    receiptDb
      .prepare("DELETE FROM automation_approval_receipts WHERE workspace_id=?")
      .run(missingReceipt.workspace.id);
    receiptDb.close();
    expect(() =>
      missingReceipt.store.listAutomationProposals(missingReceipt.workspace.id),
    ).toThrow(/missing its approval receipt/);
    expect(() =>
      missingReceipt.store.evaluateAutomationEvents(
        missingReceipt.workspace.id,
      ),
    ).toThrow();
    missingReceipt.store.close();
    const missingEvent = preparedRuntime(),
      eventDb = new DatabaseSync(missingEvent.store.databasePath);
    eventDb
      .prepare(
        "DELETE FROM automation_provisioning_events WHERE workspace_id=? AND event_type='applied'",
      )
      .run(missingEvent.workspace.id);
    eventDb.close();
    expect(() =>
      missingEvent.store.listAutomationProposals(missingEvent.workspace.id),
    ).toThrow(/provisioning state/);
    missingEvent.store.close();
    const forgedRule = preparedRuntime(),
      ruleDb = new DatabaseSync(forgedRule.store.databasePath);
    ruleDb
      .prepare("UPDATE automation_rules SET action_json=? WHERE workspace_id=?")
      .run(
        JSON.stringify({
          kind: "ai_prompt",
          provider: "claude",
          securityProfileId: "forged",
          instruction: "FORGED ACTION",
        }),
        forgedRule.workspace.id,
      );
    ruleDb.close();
    expect(() =>
      forgedRule.store.evaluateAutomationEvents(forgedRule.workspace.id),
    ).toThrow(/rule authority/);
    const ruleId = String(
      (
        forgedRule.store.listAutomationRulesAndRuns(forgedRule.workspace.id)
          .rules[0] as Record<string, unknown>
      ).id,
    );
    forgedRule.store.setAutomationRuleStatus(
      forgedRule.workspace.id,
      ruleId,
      "killed",
    );
    expect(() =>
      forgedRule.store.setAutomationRuleStatus(
        forgedRule.workspace.id,
        ruleId,
        "enabled",
      ),
    ).toThrow(/rule authority/);
    forgedRule.store.close();
  });

  it("revalidates connector and exact event binding at evaluation and claim", () => {
    const connectorMismatch = preparedRuntime(),
      mismatchDb = new DatabaseSync(connectorMismatch.store.databasePath);
    mismatchDb
      .prepare(
        "UPDATE external_inbound_events SET connector_id='github' WHERE workspace_id=?",
      )
      .run(connectorMismatch.workspace.id);
    mismatchDb.close();
    expect(
      connectorMismatch.store.evaluateAutomationEvents(
        connectorMismatch.workspace.id,
      ),
    ).toEqual({ queued: 0 });
    connectorMismatch.store.close();
    const repointed = preparedRuntime(),
      original = repointed.store.listExternalInboundEvents(
        repointed.workspace.id,
      )[0];
    repointed.store.evaluateAutomationEvents(repointed.workspace.id);
    repointed.store.importExternalInboundEvent(repointed.workspace.id, {
      eventId: original.sourceEventId,
      channelId: "unapproved_channel_01",
      connectorId: "azure_devops",
      eventType: original.eventType,
      occurredAt: original.occurredAt,
      receivedAt: original.receivedAt,
      payload: original.payload,
    });
    const replacement = repointed.store
        .listExternalInboundEvents(repointed.workspace.id)
        .find((item) => item.channelId === "unapproved_channel_01")!,
      runId = String(
        repointed.store.listAutomationRulesAndRuns(repointed.workspace.id)
          .runs[0].id,
      ),
      repointDb = new DatabaseSync(repointed.store.databasePath);
    repointDb
      .prepare("UPDATE automation_runs SET event_id=? WHERE id=?")
      .run(replacement.id, runId);
    repointDb.close();
    expect(() =>
      repointed.store.claimAutomationRun(repointed.workspace.id),
    ).toThrow(/event authority/);
    repointed.store.close();
  });

  it("restores historical decisions as inert audit evidence without restoring authority", () => {
    const { store, workspace } = preparedRuntime();
    store.evaluateAutomationEvents(workspace.id);
    const completed = store.claimAutomationRun(workspace.id)!;
    store.finishAutomationRun(
      workspace.id,
      completed.id,
      "completed",
      "Historical result",
    );
    const archive = store.exportWorkspace(workspace.id),
      restored = store.restoreWorkspace(
        archive,
        "Restored automation",
        path.join(path.dirname(store.databasePath), "restored"),
      ),
      proposal = store.listAutomationProposals(restored.id)[0];
    expect(proposal).toMatchObject({
      status: "stale",
      proposalDigest: store.listAutomationProposals(workspace.id)[0]
        .proposalDigest,
      receipt: {
        decision: "approved",
        externalMutation: { authorized: true, executed: true },
      },
    });
    const restoredHistory = store.listAutomationRulesAndRuns(restored.id),
      restoredRule = restoredHistory.rules[0] as Record<string, unknown>;
    expect(restoredHistory).toMatchObject({
      rules: [{ status: "killed" }],
      runs: [{ status: "completed", resultSummary: "Historical result" }],
    });
    expect(() =>
      store.setAutomationRuleStatus(
        restored.id,
        String(restoredRule.id),
        "enabled",
      ),
    ).toThrow(/rule authority/);
    store.close();
  });

  it("reconciles interrupted provisioning as failed with an uncertain external outcome", () => {
    const root = mkdtempSync(
        path.join(tmpdir(), "waypoint-automation-interrupted-"),
      ),
      databasePath = path.join(root, "waypoint.sqlite"),
      store = new WorkspaceStore(databasePath),
      workspace = store.createWorkspace("Interrupted", root),
      profile = store.listSecurityProfiles(workspace.id)[0],
      definition = {
        version: 1 as const,
        title: "Interrupted hook",
        trigger: {
          connectorId: "azure_devops" as const,
          eventType: "azure_devops.git.pullrequest.created",
          filters: {},
        },
        action: {
          kind: "ai_prompt" as const,
          provider: "codex" as const,
          securityProfileId: profile.id,
          instruction: "Review build",
        },
        delivery: {
          channelId: "interrupted_channel_000001",
          endpoint: "https://relay.example/v1/hooks/interrupted_channel_000001",
          reachability: "public_relay" as const,
        },
        provisioning: { mode: "az_devops_invoke" as const, organization: "https://dev.azure.com/example", project: "SCV2", repository: "SCV2", projectId: "project-id", repositoryId: "repository-id" },
      },
      proposal = store.createAutomationProposal(
        workspace.id,
        undefined,
        definition,
      );
    store.decideAutomationProposal(
      workspace.id,
      proposal.id,
      proposal.proposalDigest,
      "approve",
    );
    store.beginAutomationProvisioning(
      workspace.id,
      proposal.id,
      proposal.proposalDigest,
    );
    store.checkpointAutomationProvisioning(
      workspace.id,
      proposal.id,
      proposal.proposalDigest,
      {
        executed: true,
        outcome: "uncertain",
        rollback: {
          waypoint: {
            operation: "revoke_and_delete_channel",
            channelId: definition.delivery.channelId,
          },
          provider: {
            operation: "inspect_and_delete_exact_endpoint",
            endpoint: definition.delivery.endpoint,
          },
        },
      },
    );
    store.close();
    const reopened = new WorkspaceStore(databasePath),
      recovered = reopened.automationProposal(workspace.id, proposal.id);
    expect(recovered).toMatchObject({
      status: "failed",
      receipt: {
        externalMutation: {
          outcome: "uncertain",
          executed: true,
          rollback: {
            provider: {
              operation: "inspect_and_delete_exact_endpoint",
              endpoint: definition.delivery.endpoint,
            },
          },
        },
      },
    });
    reopened.close();
  });
});
