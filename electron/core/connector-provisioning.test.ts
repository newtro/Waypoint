import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { connectorProvisioningPreview, provisionConnector } from "./connector-provisioning.js";

const definition = {
  version: 1 as const,
  title: "Review PR",
  trigger: { connectorId: "azure_devops" as const, eventType: "azure_devops.git.pullrequest.created", filters: {} },
  action: { kind: "ai_prompt" as const, provider: "codex" as const, securityProfileId: "profile", instruction: "Review PR", maxDurationMs: 60_000 },
  delivery: { channelId: "channel_0000000000000001", endpoint: "https://waypoint-relay.johnnycode.ai/v1/native-hooks/channel_0000000000000001", reachability: "public_relay" as const },
  provisioning: { mode: "az_devops_invoke" as const, organization: "https://dev.azure.com/example", project: "Project", repository: "Repo", projectId: "project-id", repositoryId: "repo-id", targetBranch: "refs/heads/main" },
};

describe("connector provisioning", () => {
  it("previews the canonical redacted mutation and stable IDs", () => {
    const preview = connectorProvisioningPreview(definition);
    expect(preview).toContain("projectId=project-id");
    expect(preview).toContain(definition.delivery.endpoint);
    expect(preview).toContain("<protected signing secret>");
    expect(preview).not.toContain("password");
  });

  it("revalidates Azure IDs, uses a per-operation request directory, and cleans it", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-provision-")), execute = vi.fn(async (_cli: string, args: string[]) => args.includes("project") ? '{"id":"project-id"}' : args.includes("repos") ? '{"id":"repo-id"}' : args.includes("POST") ? '{"id":"subscription-id"}' : JSON.stringify({value:[{id:'subscription-id',publisherId:'tfs',status:'enabled',eventType:'git.pullrequest.created',resourceVersion:'1.0',consumerId:'webHooks',consumerActionId:'httpRequest',consumerInputs:{url:definition.delivery.endpoint,acceptUntrustedCerts:'false'},publisherInputs:{projectId:'project-id',repository:'repo-id',branch:'refs/heads/main'}}]}));
    const result = await provisionConnector({ definition, secret: "protected-secret", workspaceRoot: root, execute });
    expect(result.externalId).toBe("subscription-id");
    expect(execute).toHaveBeenCalledTimes(4);
    expect(readdirSync(root)).toEqual([]);
    expect(execute.mock.calls[2][1]).not.toContain("protected-secret");
  });

  it("rejects a changed target or hostile endpoint before provider mutation", async () => {
    const hostile = vi.fn(async () => "{}");
    await expect(provisionConnector({ definition: { ...definition, delivery: { ...definition.delivery, endpoint: "https://attacker.example/v1/native-hooks/channel_0000000000000001" } }, secret: "protected-secret", workspaceRoot: mkdtempSync(path.join(tmpdir(), "waypoint-provision-hostile-")), execute: hostile })).rejects.toThrow(/trusted Waypoint/);
    expect(hostile).not.toHaveBeenCalled();
    const changed = vi.fn(async (_cli: string, args: string[]) => args.includes("project") ? '{"id":"other-project"}' : '{"id":"repo-id"}');
    await expect(provisionConnector({ definition, secret: "protected-secret", workspaceRoot: mkdtempSync(path.join(tmpdir(), "waypoint-provision-changed-")), execute: changed })).rejects.toThrow(/changed after approval/);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("subscribes GitHub to the exact approved event and repository identity", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-provision-github-")), execute = vi.fn(async (_cli: string, args: string[]) => {
      if (args[1] === "repos/owner/repo") return '{"id":99,"full_name":"owner/repo"}';
      if(args.includes("POST")){const file = String(args.at(-1));expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ events: ["pull_request_review"] });return '{"id":42}'}
      return JSON.stringify([{id:42,name:'web',active:true,events:['pull_request_review'],config:{url:definition.delivery.endpoint,content_type:'json',insecure_ssl:'0'}}]);
    }), github = { ...definition, trigger: { connectorId: "github" as const, eventType: "github.pull_request_review", filters: {} }, provisioning: { mode: "gh_cli" as const, repository: "owner/repo", repositoryId: "99", repositoryFullName: "owner/repo" } };
    await expect(provisionConnector({ definition: github, secret: "protected-secret", workspaceRoot: root, execute })).resolves.toMatchObject({ externalId: "42" });
  });

  it("reconciles a created GitHub hook when the POST response is malformed", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-provision-reconcile-")), execute = vi.fn(async (_cli: string, args: string[]) => {
      if (args[1] === "repos/owner/repo") return '{"id":99,"full_name":"owner/repo"}';
      if (args.includes("POST")) return "warning after successful create";
      return JSON.stringify([{ id: 42, name:'web', active: true, events: ["pull_request"], config: { url: definition.delivery.endpoint, content_type:'json', insecure_ssl:'0' } }]);
    }), github = { ...definition, trigger: { connectorId: "github" as const, eventType: "github.pull_request", filters: {} }, provisioning: { mode: "gh_cli" as const, repository: "owner/repo", repositoryId: "99", repositoryFullName: "owner/repo" } };
    await expect(provisionConnector({ definition: github, secret: "protected-secret", workspaceRoot: root, execute })).resolves.toMatchObject({ externalId: "42" });
    expect(readdirSync(root)).toEqual([]);
  });

  it("defers target discovery until the approved provisioning transaction", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-provision-deferred-")),
      execute = vi.fn(async (_cli: string, args: string[]) =>
        args.includes("project")
          ? '{"id":"project-id"}'
          : args.includes("repos")
            ? '{"id":"repo-id"}'
            : args.includes("POST")
              ? '{"id":"subscription-id"}'
              : JSON.stringify({
                  value: [
                    {
                      id: "subscription-id",
                      publisherId: "tfs",
                      status: "enabled",
                      eventType: "git.pullrequest.created",
                      resourceVersion: "1.0",
                      consumerId: "webHooks",
                      consumerActionId: "httpRequest",
                      consumerInputs: {
                        url: definition.delivery.endpoint,
                        acceptUntrustedCerts: "false",
                      },
                      publisherInputs: {
                        projectId: "project-id",
                        repository: "repo-id",
                        branch: "refs/heads/main",
                      },
                    },
                  ],
                }),
      ),
      unresolved = {
        ...definition,
        provisioning: {
          mode: "az_devops_invoke" as const,
          organization: "https://dev.azure.com/example",
          project: "Project",
          repository: "Repo",
          targetBranch: "refs/heads/main",
        },
      };
    await expect(
      provisionConnector({
        definition: unresolved,
        secret: "protected-secret",
        workspaceRoot: root,
        execute,
      }),
    ).resolves.toMatchObject({
      externalId: "subscription-id",
      targetIdentity: { projectId: "project-id", repositoryId: "repo-id" },
    });
    expect(execute.mock.calls[0][1]).toContain("project");
    expect(readdirSync(root)).toEqual([]);
  });

  it("rejects a successful create response until exact provider state is reconciled", async()=>{
    const root=mkdtempSync(path.join(tmpdir(),"waypoint-provision-mismatch-")),execute=vi.fn(async(_cli:string,args:string[])=>{if(args[1]==='repos/owner/repo')return '{"id":99,"full_name":"owner/repo"}';if(args.includes('POST'))return '{"id":42}';return JSON.stringify([{id:42,active:false,events:['pull_request'],config:{url:definition.delivery.endpoint,content_type:'json',insecure_ssl:'0'}}])}),github={...definition,trigger:{connectorId:'github' as const,eventType:'github.pull_request',filters:{}},provisioning:{mode:'gh_cli' as const,repository:'owner/repo',repositoryId:'99',repositoryFullName:'owner/repo'}};
    await expect(provisionConnector({definition:github,secret:'protected-secret',workspaceRoot:root,execute})).rejects.toMatchObject({providerMutation:{externalId:'42',outcome:'uncertain'}});
  });

  it('rejects Azure readback when provider behavior fields differ from the approved request',async()=>{const root=mkdtempSync(path.join(tmpdir(),'waypoint-provision-azure-mismatch-')),execute=vi.fn(async(_cli:string,args:string[])=>args.includes('project')?'{"id":"project-id"}':args.includes('repos')?'{"id":"repo-id"}':args.includes('POST')?'{"id":"subscription-id"}':JSON.stringify({value:[{id:'subscription-id',publisherId:'other',status:'enabled',eventType:'git.pullrequest.created',resourceVersion:'9.9',consumerId:'other',consumerActionId:'other',consumerInputs:{url:definition.delivery.endpoint,acceptUntrustedCerts:'false'},publisherInputs:{projectId:'project-id',repository:'repo-id',branch:'refs/heads/main'}}]}));await expect(provisionConnector({definition,secret:'protected-secret',workspaceRoot:root,execute})).rejects.toMatchObject({providerMutation:{externalId:'subscription-id',outcome:'uncertain'}})})

  it("never reports a generic manual sender as automatically provisioned", async () => {
    const execute = vi.fn(async () => "{}");
    const generic = {
      ...definition,
      trigger: { connectorId: "generic" as const, eventType: "generic.event", filters: {} },
      provisioning: { mode: "manual" as const },
    };
    await expect(provisionConnector({ definition: generic, secret: "protected-secret", workspaceRoot: mkdtempSync(path.join(tmpdir(), "waypoint-provision-generic-")), execute })).rejects.toThrow(/manual inbound-channel setup/);
    expect(execute).not.toHaveBeenCalled();
  });
});
