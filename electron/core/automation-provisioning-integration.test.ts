import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provisionConnector } from "./connector-provisioning.js";
import { WorkspaceStore } from "./store.js";
import { DesktopSyncService } from "./sync/desktop-sync-service.js";
import { ProtectedSyncVault, type SecretProtector } from "./sync/protected-sync-vault.js";
import { assertAutomationProposalProvisionable, validateAutomationProposal } from "./webhook-automations.js";

const protector: SecretProtector = {
  available: () => true,
  encrypt: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a),
  decrypt: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a).toString(),
};

afterEach(() => vi.unstubAllGlobals());

describe("production automation provisioning stack", () => {
  it("creates the planned receiver, protects its secret, reconciles Azure, and enables the exact approved skill rule", async () => {
    const root = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), "waypoint-provisioning-stack-")),
      ),
      store = new WorkspaceStore(path.join(root, "waypoint.sqlite")),
      workspace = store.createWorkspace("Provisioning stack", root),
      profile = store.listSecurityProfiles(workspace.id).find((item) => item.name === "Bypass permissions · no prompts")!,
      vault = new ProtectedSyncVault(path.join(root, "sync-secrets"), protector),
      sync = await DesktopSyncService.create(vault);
    sync.initializeOwner(workspace.id);
    const delivery = sync.planWebhookChannel(workspace.id, "azure_devops"),
      definition = validateAutomationProposal({
        version: 1,
        title: "SCV2 automatic PR review",
        trigger: { connectorId: "azure_devops", eventType: "azure_devops.git.pullrequest.created", filters: { "resource.repository.id": "repo-id" } },
        action: { kind: "ai_skill", provider: "claude", model: "claude-opus", securityProfileId: profile.id, skillIdentifier: "auto-pr-review", instruction: "/auto-pr-review --event-context" },
        delivery,
        provisioning: { mode: "az_devops_invoke", organization: "https://dev.azure.com/example", project: "SCV2", repository: "SCV2", projectId: "project-id", repositoryId: "repo-id", targetBranch: "refs/heads/main" },
      });
    assertAutomationProposalProvisionable(definition);
    const proposal = store.createAutomationProposal(workspace.id, undefined, definition);
    store.decideAutomationProposal(workspace.id, proposal.id, proposal.proposalDigest, "approve");
    store.beginAutomationProvisioning(workspace.id, proposal.id, proposal.proposalDigest);

    const signingSecret = Buffer.alloc(32, 7).toString("base64url"),
      createdAt = new Date().toISOString();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://waypoint-relay.johnnycode.ai/v1/webhook-channels");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(Buffer.from(init?.body as Uint8Array).toString())).toMatchObject({ channelId: delivery.channelId, connectorId: "azure_devops" });
      return new Response(JSON.stringify({ channelId: delivery.channelId, workspaceId: workspace.id, recipientDeviceId: "device-recipient", recipientPublicKey: "recipient-public-key", label: definition.title, connectorId: "azure_devops", authMode: "hmac-sha256", secretVersion: 1, secret: signingSecret, status: "active", createdAt, rotatedAt: createdAt }), { status: 201, headers: { "content-type": "application/json" } });
    }));
    const channel = await sync.createWebhookChannel(workspace.id, definition.title, "azure_devops", delivery.channelId),
      protectedSecret = sync.webhookProvisioningSecret(workspace.id, channel.channelId);
    expect(channel.endpoint).toBe(delivery.endpoint);
    expect(protectedSecret).toEqual({ secret: signingSecret, secretVersion: 1 });
    expect(vault.load(workspace.id)?.webhookSecrets).toEqual([expect.objectContaining({ channelId: delivery.channelId, secret: signingSecret })]);
    store.checkpointAutomationProvisioning(workspace.id, proposal.id, proposal.proposalDigest, { executed: true, outcome: "partial", summary: "Waypoint receiver created; Azure hook pending", delivery, rollback: { waypoint: { operation: "revoke_and_delete_channel", channelId: delivery.channelId } } });

    const execute = vi.fn(async (_cli: string, args: string[]) =>
      args.includes("project") ? '{"id":"project-id"}' :
      args.includes("repos") ? '{"id":"repo-id"}' :
      args.includes("POST") ? '{"id":"subscription-id"}' :
      JSON.stringify({ value: [{ id: "subscription-id", publisherId: "tfs", status: "enabled", eventType: "git.pullrequest.created", resourceVersion: "1.0", consumerId: "webHooks", consumerActionId: "httpRequest", consumerInputs: { url: delivery.endpoint, acceptUntrustedCerts: "false" }, publisherInputs: { projectId: "project-id", repository: "repo-id", branch: "refs/heads/main" } }] }),
    );
    const provider = await provisionConnector({ definition, secret: protectedSecret.secret, workspaceRoot: path.join(root, "provider-request"), execute });
    expect(provider).toMatchObject({ connectorId: "azure_devops", externalId: "subscription-id" });
    expect(execute.mock.calls.flatMap((call) => call[1])).not.toContain(signingSecret);
    const applied = store.finishAutomationProvisioning(workspace.id, proposal.id, proposal.proposalDigest, { status: "applied", summary: provider.summary, externalId: provider.externalId, delivery, rollback: { waypoint: { operation: "revoke_and_delete_channel", channelId: delivery.channelId }, provider: provider.rollback } });
    expect(applied).toMatchObject({ status: "applied", receipt: { externalMutation: { status: "applied", externalId: "subscription-id" } } });
    expect(store.listAutomationRulesAndRuns(workspace.id).rules).toEqual([expect.objectContaining({ status: "enabled", proposalId: proposal.id, connectorId: "azure_devops", action: expect.objectContaining({ kind: "ai_skill", provider: "claude", skillIdentifier: "auto-pr-review" }) })]);
    store.close();
  });
});
