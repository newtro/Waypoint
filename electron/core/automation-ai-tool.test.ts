import { describe, expect, it } from "vitest";
import { extractAutomationProposalTool, withAutomationProposalTool } from "./automation-ai-tool.js";

describe("automation proposal AI tool",()=>{
  it("only exposes a proposal contract and strips a validated call from chat text",()=>{const prompt=withAutomationProposalTool({prompt:"Set up PR review",chatId:"chat-1",provider:"codex",model:"gpt-5",securityProfileId:"profile-1",maxDurationMs:60_000});expect(prompt).toContain("Do not claim that anything was provisioned");const answer='I prepared this for review.\n```waypoint-automation-proposal\n'+JSON.stringify({version:1,title:'Review PR',trigger:{connectorId:'github',eventType:'github.pull_request',filters:{}},action:{kind:'ai_prompt',provider:'codex',model:'gpt-5',securityProfileId:'profile-1',instruction:'Review the pull request',maxDurationMs:60000},delivery:{reachability:'not_configured'},provisioning:{mode:'gh_cli'}})+'\n```',result=extractAutomationProposalTool(answer);expect(result.displayAnswer).toBe('I prepared this for review.');expect(result.definition?.trigger.connectorId).toBe('github')});
  it("never treats malformed tool output as an approved action",()=>{const result=extractAutomationProposalTool('No change.\n```waypoint-automation-proposal\n{"version":1}\n```');expect(result.definition).toBeUndefined();expect(result.error).toMatch(/invalid/i)});
});
