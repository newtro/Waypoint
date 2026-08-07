import { describe, expect, it } from "vitest";
import { automationProposalDigest, normalizeNativeWebhook, validateAutomationProposal } from "./webhook-automations.js";

describe("generalized webhook automations", () => {
  it("normalizes Azure DevOps PR events without retaining credentials", () => {
    const body = Buffer.from(JSON.stringify({ id: "delivery-12345", eventType: "git.pullrequest.created", createdDate: "2026-08-07T12:00:00.000Z", secretToken: "remove-me", resource: { pullRequestId: 42, title: "Improve hooks", repository: { id: "repo-1", name: "Waypoint" } } }));
    expect(normalizeNativeWebhook({ connectorId: "azure_devops", headers: {}, body })).toMatchObject({ connectorId: "azure_devops", sourceEventId: "delivery-12345", eventType: "azure_devops.git.pullrequest.created", occurredAt: "2026-08-07T12:00:00.000Z", payload: { "resource.pullRequestId": 42, "resource.title": "Improve hooks", "resource.repository.id": "repo-1" } });
    expect(JSON.stringify(normalizeNativeWebhook({ connectorId: "azure_devops", headers: {}, body }))).not.toContain("remove-me");
  });

  it("binds approval to every security-relevant proposal field", () => {
    const proposal = validateAutomationProposal({ version: 1, title: "Review new PR", trigger: { connectorId: "azure_devops", eventType: "azure_devops.git.pullrequest.created", filters: { repository: "repo-1" } }, action: { kind: "ai_prompt", provider: "codex", model: "gpt-5", securityProfileId: "profile-1", instruction: "Review the pull request", maxDurationMs: 60_000 }, delivery: { channelId: "channel_0000000000000001", endpoint: "https://relay.example/v1/native-hooks/channel_0000000000000001", reachability: "public_relay" }, provisioning: { mode: "az_devops_invoke", organization: "https://dev.azure.com/example", project: "Project", repository: "repo-1" } });
    const changed = structuredClone(proposal); changed.action.provider = "claude";
    expect(automationProposalDigest(changed)).not.toBe(automationProposalDigest(proposal));
  });

  it("bounds normalized payloads below the durable event storage limit", () => {
    const body = Buffer.from(JSON.stringify(Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field_${index}`, "x".repeat(10_000)]))));
    const event = normalizeNativeWebhook({ connectorId: "generic", headers: { "x-waypoint-event": "build.completed" }, body });
    expect(Object.keys(event.payload)).toHaveLength(48);
    expect(Buffer.byteLength(JSON.stringify(event.payload), "utf8")).toBeLessThan(64 * 1024);
  });

  it("rejects extra fields, secret filters, nested filters, and unsupported action routes", () => {
    const valid = { version: 1, title: "Review new PR", trigger: { connectorId: "github", eventType: "github.pull_request", filters: { "repository.id": "repo-1" } }, action: { kind: "ai_prompt", provider: "codex", securityProfileId: "profile-1", instruction: "Review the pull request", maxDurationMs: 60_000 }, delivery: { channelId: "channel_0000000000000001", endpoint: "https://relay.example/v1/native-hooks/channel_0000000000000001", reachability: "public_relay" }, provisioning: { mode: "gh_cli", repository: "owner/repo" } };
    expect(validateAutomationProposal(valid)).toMatchObject({ action: { provider: "codex" } });
    expect(() => validateAutomationProposal({ ...valid, arbitrary: true })).toThrow(/unsupported fields/);
    expect(() => validateAutomationProposal({ ...valid, trigger: { ...valid.trigger, filters: { token: "secret" } } })).toThrow(/filters/);
    expect(() => validateAutomationProposal({ ...valid, trigger: { ...valid.trigger, filters: { repository: { id: "repo-1" } } } })).toThrow(/filters/);
    expect(() => validateAutomationProposal({ ...valid, action: { ...valid.action, provider: "openrouter" } })).toThrow(/action/);
  });
});
