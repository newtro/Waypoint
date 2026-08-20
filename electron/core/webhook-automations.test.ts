import { describe, expect, it } from "vitest";
import { assertAutomationProposalProvisionable, automationProposalDigest, normalizeNativeWebhook, proposalConfirmationPrompt, validateAutomationProposal } from "./webhook-automations.js";

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

  it("binds an exact slash skill into the digest-covered automation action", () => {
    const action = { kind: "ai_skill", provider: "claude", model: "claude-sonnet", securityProfileId: "profile-1", skillIdentifier: "auto-pr-review", instruction: "/auto-pr-review --event-context", maxDurationMs: 60_000 }, proposal = validateAutomationProposal({ version: 1, title: "Automatic PR review", trigger: { connectorId: "azure_devops", eventType: "azure_devops.git.pullrequest.created", filters: { "resource.repository.id": "repo-id" } }, action, delivery: { reachability: "not_configured" }, provisioning: { mode: "az_devops_invoke", organization: "https://dev.azure.com/example", project: "scv2", repository: "repo" } });
    expect(proposal.action).toEqual(action);
    expect(() => validateAutomationProposal({ ...proposal, action: { ...action, instruction: "Review without invoking it" } })).toThrow("skill invocation");
  });

  it("rejects extra fields, secret filters, nested filters, and unsupported action routes", () => {
    const valid = { version: 1, title: "Review new PR", trigger: { connectorId: "github", eventType: "github.pull_request", filters: { "repository.id": "repo-1" } }, action: { kind: "ai_prompt", provider: "codex", securityProfileId: "profile-1", instruction: "Review the pull request", maxDurationMs: 60_000 }, delivery: { channelId: "channel_0000000000000001", endpoint: "https://relay.example/v1/native-hooks/channel_0000000000000001", reachability: "public_relay" }, provisioning: { mode: "gh_cli", repository: "owner/repo" } };
    expect(validateAutomationProposal(valid)).toMatchObject({ action: { provider: "codex" } });
    expect(() => validateAutomationProposal({ ...valid, arbitrary: true })).toThrow(/unsupported fields/);
    expect(() => validateAutomationProposal({ ...valid, trigger: { ...valid.trigger, filters: { token: "secret" } } })).toThrow(/filters/);
    expect(() => validateAutomationProposal({ ...valid, trigger: { ...valid.trigger, filters: { repository: { id: "repo-1" } } } })).toThrow(/filters/);
    expect(() => validateAutomationProposal({ ...valid, action: { ...valid.action, provider: "openrouter" } })).toThrow(/action/);
  });

  it("requires a real Waypoint receiver before creating an approval question",()=>{const base=validateAutomationProposal({version:1,title:'Review PR',trigger:{connectorId:'azure_devops',eventType:'azure_devops.git.pullrequest.created',filters:{}},action:{kind:'ai_prompt',provider:'claude',securityProfileId:'profile',instruction:'Review PR'},delivery:{reachability:'not_configured'},provisioning:{mode:'az_devops_invoke',organization:'https://dev.azure.com/example',project:'SCV2',repository:'SCV2'}});expect(()=>assertAutomationProposalProvisionable(base)).toThrow(/Waypoint receiver prerequisite.*No confirmation card/s);const local=validateAutomationProposal({...base,delivery:{channelId:'channel_0000000000000001',endpoint:'https://localhost:8443/v1/native-hooks/channel_0000000000000001',reachability:'local_network'}});expect(()=>assertAutomationProposalProvisionable(local)).toThrow(/publicly reachable trusted HTTPS relay/);const ready=validateAutomationProposal({...base,delivery:{channelId:'channel_0000000000000001',endpoint:'https://relay.example/v1/native-hooks/channel_0000000000000001',reachability:'public_relay'}});expect(()=>assertAutomationProposalProvisionable(ready)).not.toThrow();const prompt=proposalConfirmationPrompt(ready);expect(prompt).toContain('Waypoint will create receiver channel_0000000000000001');expect(prompt).toContain('protect its signing secret');expect(prompt).toContain('provider-native');expect(prompt).not.toContain('bounded')});
  it("rejects a new durable Waypoint duration limit instead of approving a value the runtime ignores",()=>{const limited=validateAutomationProposal({version:1,title:'Limited',trigger:{connectorId:'generic',eventType:'generic.test',filters:{}},action:{kind:'ai_prompt',provider:'claude',securityProfileId:'profile',instruction:'Run',maxDurationMs:5000},delivery:{channelId:'channel_0000000000000001',endpoint:'https://relay.example/v1/hooks/channel_0000000000000001',reachability:'public_relay'},provisioning:{mode:'manual'}});expect(()=>assertAutomationProposalProvisionable(limited)).toThrow(/provider-native completion.*Remove maxDurationMs/)});
  it("rejects an unprovisionable generic sender before creating an approval card",()=>{const generic=validateAutomationProposal({version:1,title:'Generic event',trigger:{connectorId:'generic',eventType:'generic.test',filters:{}},action:{kind:'ai_prompt',provider:'claude',securityProfileId:'profile',instruction:'Run'},delivery:{channelId:'channel_0000000000000001',endpoint:'https://relay.example/v1/hooks/channel_0000000000000001',reachability:'public_relay'},provisioning:{mode:'manual'}});expect(()=>assertAutomationProposalProvisionable(generic)).toThrow(/Generic sender prerequisite.*no confirmation card.*no receiver, sender, or automation rule was changed/s)});
});
