import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AutomationProposalDefinition } from "./webhook-automations.js";
import { WAYPOINT_RELAY_ORIGIN } from "./sync/desktop-relay-client.js";

export type CliExecutor = (cli: "az" | "gh", args: string[]) => Promise<string>;
type TargetIdentity = { projectId?: string; repositoryId?: string; repositoryFullName?: string };

const required = (value: string | undefined, label: string) => {
  if (!value?.trim()) throw new Error(`${label} is required for connector provisioning`);
  return value.trim();
};
const outputJson = (value: string, label: string): Record<string, unknown> => {
  try { return JSON.parse(value) as Record<string, unknown>; }
  catch { throw new Error(`${label} returned invalid JSON`); }
};
const stableId = (value: unknown, label: string) => {
  const id = required(typeof value === "string" || typeof value === "number" ? String(value) : undefined, label);
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) throw new Error(`${label} is invalid`);
  return id;
};
const githubRepository = (value: string | undefined) => {
  const repository = required(value, "GitHub owner/repository");
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) throw new Error("GitHub owner/repository is invalid");
  return repository;
};
const azureOrganization = (value: string | undefined) => {
  const organization = required(value, "Azure DevOps organization");
  let url: URL;
  try { url = new URL(organization); } catch { throw new Error("Azure DevOps organization URL is invalid"); }
  if (url.protocol !== "https:" || url.hostname !== "dev.azure.com" || !/^\/[A-Za-z0-9_.-]{1,100}\/?$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error("Azure DevOps organization URL is invalid");
  return url.toString().replace(/\/$/, "");
};
function trustedProviderEndpoint(value: string) {
  let endpoint: URL;
  try { endpoint = new URL(value); } catch { throw new Error("Webhook endpoint is invalid"); }
  if (endpoint.protocol !== "https:" || endpoint.origin !== new URL(WAYPOINT_RELAY_ORIGIN).origin || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/v1\/native-hooks\/[A-Za-z0-9_-]{16,128}$/.test(endpoint.pathname)) throw new Error("Cloud connector endpoint must be an exact trusted Waypoint HTTPS native-hook URL");
  return endpoint.toString();
}

export async function discoverConnectorTarget(definition: AutomationProposalDefinition, execute: CliExecutor): Promise<TargetIdentity> {
  if (definition.trigger.connectorId === "azure_devops") {
    const organization = azureOrganization(definition.provisioning.organization), project = required(definition.provisioning.project, "Azure DevOps project"), repository = required(definition.provisioning.repository, "Azure DevOps repository"), projectResult = outputJson(await execute("az", ["devops", "project", "show", "--organization", organization, "--project", project, "--output", "json", "--only-show-errors"]), "Azure DevOps project discovery"), repositoryResult = outputJson(await execute("az", ["repos", "show", "--organization", organization, "--project", project, "--repository", repository, "--output", "json", "--only-show-errors"]), "Azure DevOps repository discovery");
    return { projectId: stableId(projectResult.id, "Azure DevOps project ID"), repositoryId: stableId(repositoryResult.id, "Azure DevOps repository ID") };
  }
  if (definition.trigger.connectorId === "github") {
    const repository = githubRepository(definition.provisioning.repository), result = outputJson(await execute("gh", ["api", `repos/${repository}`, "--method", "GET"]), "GitHub repository discovery"), repositoryId = stableId(result.id, "GitHub repository ID"), repositoryFullName = required(typeof result.full_name === "string" ? result.full_name : undefined, "GitHub repository full name");
    if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repositoryFullName)) throw new Error("GitHub repository full name is invalid");
    return { repositoryId, repositoryFullName };
  }
  return {};
}

function assertApprovedTarget(definition: AutomationProposalDefinition, discovered: TargetIdentity) {
  for (const key of ["projectId", "repositoryId", "repositoryFullName"] as const) {
    const approved = definition.provisioning[key];
    if (approved !== undefined && approved !== discovered[key])
      throw new Error(`Provider target ${key} changed after approval; create a fresh proposal`);
  }
}

function azureRequest(definition: AutomationProposalDefinition, endpoint: string, secret: string) {
  return { publisherId: "tfs", eventType: definition.trigger.eventType.replace(/^azure_devops\./, ""), resourceVersion: "1.0", consumerId: "webHooks", consumerActionId: "httpRequest", publisherInputs: { projectId: required(definition.provisioning.projectId, "Approved Azure DevOps project ID"), repository: required(definition.provisioning.repositoryId, "Approved Azure DevOps repository ID"), ...(definition.provisioning.targetBranch ? { branch: definition.provisioning.targetBranch } : {}) }, consumerInputs: { url: endpoint, acceptUntrustedCerts: "false", basicAuthCredentials: `waypoint:${secret}` } };
}
function githubRequest(definition: AutomationProposalDefinition, endpoint: string, secret: string) {
  const event = definition.trigger.eventType.replace(/^github\./, "");
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(event)) throw new Error("GitHub webhook event must match the exact X-GitHub-Event name");
  return { name: "web", active: true, events: [event], config: { url: endpoint, content_type: "json", insecure_ssl: "0", secret } };
}
const redacted = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "string" && (item.startsWith("waypoint:") || item === "<secret>") ? "<protected signing secret>" : item);

export function connectorProvisioningPreview(definition: AutomationProposalDefinition, endpoint = definition.delivery.endpoint) {
  const target = endpoint ?? "<endpoint unavailable until sync is configured>";
  if (definition.trigger.connectorId === "azure_devops") return `Azure DevOps POST subscription target projectId=${definition.provisioning.projectId ?? "<read-only discovery required>"}, repositoryId=${definition.provisioning.repositoryId ?? "<read-only discovery required>"}: ${redacted(azureRequest({ ...definition, provisioning: { ...definition.provisioning, projectId: definition.provisioning.projectId ?? "<project-id>", repositoryId: definition.provisioning.repositoryId ?? "<repository-id>" } }, target, "<secret>"))}`;
  if (definition.trigger.connectorId === "github") return `GitHub repositoryId=${definition.provisioning.repositoryId ?? "<read-only discovery required>"}, fullName=${definition.provisioning.repositoryFullName ?? definition.provisioning.repository ?? "<repository>"}, POST hook: ${redacted(githubRequest(definition, target, "<secret>"))}`;
  if (definition.trigger.connectorId === "stripe" || definition.trigger.connectorId === "resend") return `${definition.trigger.connectorId} is unavailable until provider signing-secret import is implemented; no endpoint will be created`;
  return `Create Waypoint channel ${definition.delivery.channelId ?? "<channel>"} at ${target} and copy its one-time encrypted HMAC sender configuration`;
}

function values(value: Record<string, unknown>): Array<Record<string, unknown>> {
  const rows = Array.isArray(value.value) ? value.value : Array.isArray(value) ? value : [];
  return rows.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

export async function provisionConnector(input: { definition: AutomationProposalDefinition; secret: string; workspaceRoot: string; execute: CliExecutor }) {
  const { definition: approvedDefinition, secret, workspaceRoot, execute } = input,
    rawEndpoint = required(approvedDefinition.delivery.endpoint, "A public webhook endpoint"),
    endpoint = approvedDefinition.trigger.connectorId === "generic" ? rawEndpoint : trustedProviderEndpoint(rawEndpoint),
    discovered = approvedDefinition.trigger.connectorId === "azure_devops" || approvedDefinition.trigger.connectorId === "github"
      ? await discoverConnectorTarget(approvedDefinition, execute)
      : {},
    definition: AutomationProposalDefinition = {
      ...approvedDefinition,
      provisioning: { ...approvedDefinition.provisioning, ...discovered },
    };
  if (definition.delivery.reachability !== "public_relay" && definition.trigger.connectorId !== "generic") throw new Error("This cloud connector requires a publicly reachable trusted relay endpoint");
  if (definition.trigger.connectorId === "azure_devops" || definition.trigger.connectorId === "github") assertApprovedTarget(approvedDefinition, discovered);
  const operationRoot = path.join(workspaceRoot, randomUUID());
  mkdirSync(operationRoot, { recursive: true, mode: 0o700 });
  try {
    if (definition.trigger.connectorId === "azure_devops") {
      const organization = azureOrganization(definition.provisioning.organization), body = azureRequest(definition, endpoint, secret), file = path.join(operationRoot, "request.json");
      writeFileSync(file, JSON.stringify(body), { encoding: "utf8", flag: "wx", mode: 0o600 });
      let externalId: string | undefined,creationError:unknown;
      try { externalId = stableId(outputJson(await execute("az", ["devops", "invoke", "--organization", organization, "--area", "hooks", "--resource", "subscriptions", "--http-method", "POST", "--api-version", "7.1", "--in-file", file, "--encoding", "utf-8", "--output", "json", "--only-show-errors"]), "Azure DevOps service hook creation").id, "Azure DevOps service hook ID"); }
      catch (error) { creationError=error }
      const createdExternalId=externalId;
      try { const listed = outputJson(await execute("az", ["devops", "invoke", "--organization", organization, "--area", "hooks", "--resource", "subscriptions", "--http-method", "GET", "--api-version", "7.1", "--output", "json", "--only-show-errors"]), "Azure DevOps service hook reconciliation"), match = values(listed).find((item) => (!externalId||String(item.id)===externalId)&&item.publisherId===body.publisherId&&item.eventType === body.eventType&&item.resourceVersion===body.resourceVersion&&item.consumerId===body.consumerId&&item.consumerActionId===body.consumerActionId&&!['disabled','error'].includes(String(item.status??'enabled').toLowerCase()) && (item.consumerInputs as Record<string, unknown> | undefined)?.url === endpoint && String((item.consumerInputs as Record<string, unknown> | undefined)?.acceptUntrustedCerts)==='false' && (item.publisherInputs as Record<string, unknown> | undefined)?.projectId === body.publisherInputs.projectId && (item.publisherInputs as Record<string, unknown> | undefined)?.repository === body.publisherInputs.repository && ((item.publisherInputs as Record<string, unknown> | undefined)?.branch??undefined)===(body.publisherInputs.branch??undefined));externalId=match?stableId(match.id,"Azure DevOps reconciled service hook ID"):undefined } catch(error){creationError??=error}
      if (!externalId) throw Object.assign(new Error("Azure DevOps hook creation outcome is uncertain; inspect provider hooks for the exact approved endpoint before retrying", { cause: creationError }),{providerMutation:{connectorId:'azure_devops',outcome:'uncertain',endpoint,externalId:createdExternalId,rollback:createdExternalId?{operation:'delete_service_hook',organization,externalId:createdExternalId}:{operation:'inspect_and_delete_exact_endpoint',organization,endpoint}}});
      return { connectorId: "azure_devops" as const, externalId, targetIdentity: discovered, summary: "Azure DevOps service hook created and reconciled", rollback: { cli: "az" as const, operation: "delete_service_hook", organization, externalId } };
    }
    if (definition.trigger.connectorId === "github") {
      const repository = githubRepository(definition.provisioning.repositoryFullName ?? definition.provisioning.repository), body = githubRequest(definition, endpoint, secret), file = path.join(operationRoot, "request.json");
      writeFileSync(file, JSON.stringify(body), { encoding: "utf8", flag: "wx", mode: 0o600 });
      let externalId: string | undefined,creationError:unknown;
      try { externalId = stableId(outputJson(await execute("gh", ["api", `repos/${repository}/hooks`, "--method", "POST", "--input", file]), "GitHub webhook creation").id, "GitHub webhook ID"); }
      catch (error) { creationError=error }
      const createdExternalId=externalId;
      try { const listed = JSON.parse(await execute("gh", ["api", `repos/${repository}/hooks?per_page=100`, "--method", "GET"])); const rows = Array.isArray(listed) ? listed as Array<Record<string, unknown>> : []; const match = rows.find((item) => (!externalId||String(item.id)===externalId)&&item.name===body.name&&item.active===true&&(item.config as Record<string, unknown> | undefined)?.url === endpoint&&(item.config as Record<string, unknown> | undefined)?.content_type==='json'&&String((item.config as Record<string, unknown> | undefined)?.insecure_ssl)==='0'&&Array.isArray(item.events)&&item.events.length===1&&item.events[0]===body.events[0]);externalId=match?stableId(match.id,"GitHub reconciled webhook ID"):undefined } catch(error){creationError??=error}
      if (!externalId) throw Object.assign(new Error("GitHub hook creation outcome is uncertain; inspect repository hooks for the exact approved endpoint before retrying", { cause: creationError }),{providerMutation:{connectorId:'github',outcome:'uncertain',endpoint,externalId:createdExternalId,rollback:createdExternalId?{operation:'delete_repository_hook',repository,externalId:createdExternalId}:{operation:'inspect_and_delete_exact_endpoint',repository,endpoint}}});
      return { connectorId: "github" as const, externalId, targetIdentity: discovered, summary: "GitHub webhook created and reconciled", rollback: { cli: "gh" as const, operation: "delete_repository_hook", repository, repositoryId: definition.provisioning.repositoryId, externalId } };
    }
    if (definition.trigger.connectorId === "generic") throw new Error("Generic senders require manual inbound-channel setup and verified signing-secret handoff; automatic provisioning did not run");
    throw new Error(`${definition.trigger.connectorId} automatic provisioning is unavailable until provider API credentials and signing-secret return are configured`);
  } finally { try{rmSync(operationRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })}catch{/* Startup cleanup retries this private per-operation directory; provider provenance must not be lost. */} }
}
