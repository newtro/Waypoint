import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { accessSync, constants, lstatSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { WorkspaceStore } from './core/store.js';
import { LocalOllamaEmbeddings } from './core/ollama.js';
import { CHUNKING_POLICIES, chunkingDigest, storedChunkingProvenance } from './core/embedding-benchmark.js';
import { CliWorkbench, type ExecutionEvent } from './core/ai-workbench.js';
import { detectCli } from '../spikes/cli-capabilities.js';
import { deleteWithExecutionCancellation, startDurableChild, validateOneChildDelegation } from './core/execution-lifecycle.js';
import { finalizeExecution } from './core/execution-finalization.js';
import { readBackup, writeAtomicBackup } from './core/backup.js';
import {runBackupAdministration} from './core/backup-administration-runner.js';
import {extractDocumentOffMain} from './core/document-extraction-runner.js';
import {chunkExtractedText,DOCUMENT_CHUNKING_POLICY,type DocumentChunk} from './core/document-ingestion.js';
import { exportDiagnosticsReport, runDiagnostics } from './core/diagnostics.js';
import { sanitizeSyncStatus } from './core/sync/sync-status.js';
import { ATTACHMENT_MEDIA_BY_EXTENSION, MAX_ATTACHMENTS_PER_OWNER, readAndValidateAttachment } from './core/chat-attachments.js';
import { isEffectivelyMaximized, restoreWindowState, type SavedWindowState, type WindowBounds } from './core/window-state.js';
import { ProtectedSyncVault } from './core/sync/protected-sync-vault.js';
import { DesktopSyncService } from './core/sync/desktop-sync-service.js';
import { recordSyncActivityBestEffort } from './core/activity-recording.js';
import { assertRoute, proposeRoute } from './core/provider-routing.js';
import {assertChildAgainstParent,childContext,createChildTask,type ChildTaskManifest} from './core/agent-policy.js';
import {createExecutionBudget,securityProfileDigest,serializeExecutionBudget} from './core/execution-budget.js';
import {ToolGateway,discoverLocalCli,validatePolicy,type ToolGatewayPolicy,type ToolRequest} from './core/tool-gateway.js';
import {failureIdentity,localFailureContext,safeFailureNote,workspaceFailureKey} from './core/tool-failure-learning.js';
import {ProtectedProviderVault} from './core/protected-provider-vault.js';
import {FetchOpenRouterTransport,OpenRouterBudgetGate,OpenRouterClient,decideHostedRoute,openRouterCapability,type ProviderUsageReceipt} from './core/openrouter-provider.js';
import{VoiceRuntimeRegistry}from'./core/voice-runtime.js';
import{FastLocalSpeechProcessAdapter,FastLocalTranscriptionProcessAdapter,type FastSpeechMetric}from'./core/fast-local-speech.js';
import{macActivityCaptureReadiness,validateActivityCapturePolicy}from'./core/activity-capture.js';
import{VoiceOperationRegistry}from'./core/voice-turn-manager.js';
import{fixtureVoiceMetrics,VoicePackManager,type VoiceEngineId}from'./core/voice-engine.js';
import{remotePolicyDigest}from'./core/cross-device-control.js';
import{installedCliModelCatalog}from'./core/provider-model-catalog.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let store: WorkspaceStore;
let syncService: DesktopSyncService;
const activeSyncRuns = new Set<string>();
const syncAbort = new AbortController();
let trustedSenderId: number | undefined;
let trustedRendererUrl: string | undefined;
const embeddings = new LocalOllamaEmbeddings();
const activeDocumentIndexes=new Set<string>();
const activeChunkingProvenance=storedChunkingProvenance(CHUNKING_POLICIES[0]);
const documentChunkingDigest=chunkingDigest(DOCUMENT_CHUNKING_POLICY);
const workbench = new CliWorkbench();
let toolGateway:ToolGateway;
let toolFailureFingerprintKey:Buffer;
let providerVault:ProtectedProviderVault;
const openRouterClient=new OpenRouterClient(new FetchOpenRouterTransport()),openRouterBudget=new OpenRouterBudgetGate(),activeHostedRuns=new Map<string,{workspaceId:string;controller:AbortController}>();
let voiceRuntime:VoiceRuntimeRegistry,voicePacks:VoicePackManager,fastVoiceSpeech:FastLocalSpeechProcessAdapter,fastVoiceTranscription:FastLocalTranscriptionProcessAdapter,fastVoiceMetric:FastSpeechMetric|undefined,fastInterruptionMs:number|undefined,fastVoicePackageBytes=0;const voiceStopRequests=new Map<string,number>(),voiceOperations=new VoiceOperationRegistry();type SpeechResult='completed'|'canceled'|'failed';let voiceSpeechOwner:{workspaceId:string;chatId:string;turnId:number;notify:(result:SpeechResult)=>void}|undefined;
export function voiceFailureCode(error:unknown){const value=error instanceof Error?error.message:'';return['voice_audio_size_invalid','voice_audio_invalid','voice_stt_unavailable','voice_transcript_invalid','voice_canceled','voice_runtime_incompatible','voice_global_stop_active'].includes(value)?value:'voice_runtime_failed'}
function providerKeyConfigured(){try{providerVault.getKey();return true}catch{return false}}
const toolWindowWorkspaces=new Map<number,string>();
const activeRemoteJobs=new Set<string>();
const activeReflectionRuns=new Map<string,string>();
const killedReflectionWorkspaces=new Set<string>();
const cancelledReflectionReservations=new Set<string>();

async function processRemoteJobs(workspaceId:string){const sync=syncService.status(workspaceId);if(!sync.configured||!sync.deviceId||activeRemoteJobs.has(workspaceId))return;activeRemoteJobs.add(workspaceId);try{store.recoverRemoteJobs(workspaceId);const profile=store.listSecurityProfiles(workspaceId).find((item)=>item.name==='Autonomous developer'&&item.peerEligible);if(!profile)return;const claimed=store.claimRemoteJob(workspaceId,sync.deviceId,sync.keyEpoch,securityProfileDigest(profile));if(!claimed)return;store.startRemoteJob(workspaceId,claimed.job.id,claimed.leaseId);try{const execution=await toolGateway.execute({version:1,workspaceId,origin:'ui',tool:'waypoint.command',arguments:{command:'workspace.summary',input:{}}},gatewayPolicy(workspaceId)),receipt=execution.result?.receipt;if(!receipt||receipt.status!=='completed')throw new Error(receipt?.code??'remote_domain_command_failed');store.finishRemoteJob(workspaceId,claimed.job.id,claimed.leaseId,'completed','Workspace summary completed on the selected device')}catch(error){try{store.finishRemoteJob(workspaceId,claimed.job.id,claimed.leaseId,'failed','Target device could not complete the bounded domain command',error instanceof Error?error.message:'remote_command_failed')}catch{/* cancellation or lease expiry won */}}}finally{activeRemoteJobs.delete(workspaceId)}}

function gatewayPolicy(workspaceId:string):ToolGatewayPolicy{
  const profile=store.listSecurityProfiles(workspaceId).find((item)=>item.name==='Autonomous developer');if(!profile)throw new Error('Autonomous developer profile is unavailable');const settings=store.toolGatewaySettings(workspaceId),environmentSecrets=Object.keys(process.env).filter((name)=>/(?:TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|AUTH|API_KEY|PRIVATE_KEY|CREDENTIAL)/i.test(name)),policy:ToolGatewayPolicy={profileName:profile.name,roots:profile.roots,denyPatterns:settings.denyPatterns,stopped:settings.stopped,secretNames:[...new Set([...profile.secretNames,...environmentSecrets])],maxDurationMs:Math.min(120_000,profile.maxDurationMs),maxConcurrency:Math.min(4,profile.maxConcurrency),suppressCommit:settings.suppressCommit,suppressPush:settings.suppressPush};validatePolicy(policy);return policy
}

function loadToolFailureFingerprintKey():Buffer{
  if(!safeStorage.isEncryptionAvailable())throw new Error('Protected storage is required for tool failure fingerprints')
  const target=path.join(app.getPath('userData'),'tool-failure-fingerprint.key'),temporary=`${target}.partial`
  try{const key=Buffer.from(safeStorage.decryptString(readFileSync(target)),'base64');if(key.length!==32)throw new Error('Invalid protected fingerprint key');return key}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const key=randomBytes(32);writeFileSync(temporary,safeStorage.encryptString(key.toString('base64')),{flag:'wx',mode:0o600});renameSync(temporary,target);return key
}

function toolFailureKeyFor(workspaceId:string,vault:ProtectedSyncVault):{key:Buffer;capabilityVersion:string}{const secrets=vault.load(workspaceId);return secrets?workspaceFailureKey(secrets.workspaceKey,secrets.keyEpoch):{key:toolFailureFingerprintKey,capabilityVersion:'1.0.0/fingerprint:device-v1'}}

async function indexImportedDocument(workspaceId:string,documentId:string,revisionId:string,attachmentId:string,chunks:DocumentChunk[]=chunkExtractedText(store.listDocuments(workspaceId).find((item)=>item.id===documentId)?.body??'')){
  const key=`${workspaceId}:${documentId}`;if(activeDocumentIndexes.has(key))return{state:'index_busy' as const,chunkCount:chunks.length,provider:embeddings.provider,model:embeddings.model};activeDocumentIndexes.add(key);try{const status=await embeddings.status();if(!status.reachable||!status.modelInstalled)return{state:'provider_unavailable' as const,chunkCount:chunks.length,provider:embeddings.provider,model:embeddings.model};
  const deadline=AbortSignal.timeout(300_000),vectors:number[][]=[];let modelDigest:string|undefined;for(let offset=0;offset<chunks.length;offset+=32){const result=await embeddings.embed(chunks.slice(offset,offset+32).map((chunk)=>chunk.text),deadline);if(modelDigest&&result.modelDigest!==modelDigest)throw new Error('Embedding model changed during indexing');modelDigest=result.modelDigest;vectors.push(...result.vectors)}
  if(!modelDigest)throw new Error('Embedding provider returned no model provenance');store.replaceDocumentChunkGeneration(workspaceId,{documentId,revisionId,attachmentId},chunks.map((chunk,index)=>({...chunk,vector:vectors[index]})),{provider:embeddings.provider,providerVersion:embeddings.providerVersion,model:embeddings.model,modelDigest});return{state:'indexed' as const,chunkCount:chunks.length,provider:embeddings.provider,model:embeddings.model,modelDigest};}finally{activeDocumentIndexes.delete(key)}
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, input: unknown) => unknown): void {
  ipcMain.handle(channel, (event, input) => {
    if (event.sender.id !== trustedSenderId || event.senderFrame?.url !== trustedRendererUrl) throw new Error('Unauthorized renderer');
    return listener(event, input);
  });
}
handle('waypoint:open-external',async(_event,input:unknown)=>{const value=String((input as Record<string,unknown>)?.url??'');if(value.length>2048)throw new Error('External link is invalid');const url=new URL(value);if(url.href.length>2048||!['https:','http:','mailto:'].includes(url.protocol)||url.username||url.password)throw new Error('External link is not allowed');await shell.openExternal(url.href);return{opened:true}});

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${field}`);
  return value;
}
function directoryBytes(root:string):number{try{const stat=lstatSync(root);if(stat.isSymbolicLink())return 0;if(stat.isFile())return stat.size;if(!stat.isDirectory())return 0;return readdirSync(root).reduce((sum,item)=>sum+directoryBytes(path.join(root,item)),0)}catch{return 0}}
async function crossPlatformVoiceCapability(){const[sttReady,ttsReady]=await Promise.all([fastVoiceTranscription.probe(),fastVoiceSpeech.probe()]);return{stt:{available:sttReady,provider:'sherpa-whisper' as const,reason:sttReady?'Bundled cross-platform Whisper tiny.en transcription is ready offline.':'Bundled local transcription failed its runtime probe. Reinstall Waypoint.',source:'bundled' as const,model:'Whisper tiny.en int8'},tts:{available:ttsReady,provider:ttsReady?'sherpa-kitten' as const:'unavailable' as const,reason:ttsReady?'Bundled cross-platform Kitten speech is ready offline.':'Bundled local speech synthesis failed its runtime probe. Reinstall Waypoint.'},rawAudioPersistence:false as const,cloudSpeech:false as const}}
function recordVoiceStopRequest(key:string){voiceStopRequests.set(key,performance.now());setTimeout(()=>voiceStopRequests.delete(key),5_000).unref()}

async function collectDiagnostics(workspaceId: string) {
  const local = store.localDiagnostics(workspaceId),
    capabilities = await Promise.all([detectCli('codex'), detectCli('claude')]);
  return runDiagnostics({
    database: async () => ({
      schemaVersion: local.schemaVersion,
      expectedSchemaVersion: local.expectedSchemaVersion,
      integrity: local.integrity,
      foreignKeyViolations: local.foreignKeyViolations,
    }),
    storage: async () => {
      const stats = statfsSync(app.getPath('userData'));
      let writable = true;
      try {
        accessSync(app.getPath('userData'), constants.W_OK);
      } catch {
        writable = false;
      }
      return {
        freeBytes: Number(stats.bavail) * Number(stats.bsize),
        minimumFreeBytes: 512 * 1024 * 1024,
        writable,
      };
    },
    attachments: async () => ({
      missingFiles: local.missingFiles,
      orphanFiles: local.orphanFiles,
      digestMismatches: local.digestMismatches,
    }),
    search: async () => ({
      indexedObjects: local.indexedObjects,
      expectedObjects: local.expectedObjects,
    }),
    embeddings: () => embeddings.status(),
    cli: async (provider) => {
      const state = capabilities.find((candidate) => candidate.name === provider);
      return {
        configured: Boolean(state?.executable),
        available: Boolean(state?.available),
        version: state?.version,
      };
    },
    sync: async () => {
      const sync = store.syncStatus(workspaceId);
      return {
        configured: syncService.status(workspaceId).configured,
        pending: Number(sync.pendingMutations ?? 0),
        conflicts: Number(sync.conflicts ?? 0),
        activePeers: 0,
      };
    },
  });
}

function registerIpc(): void {
  handle('waypoint:bootstrap', () => ({ workspaces: store.listWorkspaces() }));
  handle('waypoint:activity-capture-status',(_event,input:unknown)=>{const workspaceId=text((input as Record<string,unknown>).workspaceId,'workspace ID',64);return{policy:store.activityCapturePolicy(workspaceId),readiness:macActivityCaptureReadiness(),storage:store.activityCaptureStorage(workspaceId)}});
  handle('waypoint:activity-capture-update',(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),policy=validateActivityCapturePolicy(value.policy);return{policy:store.setActivityCapturePolicy(workspaceId,policy),readiness:macActivityCaptureReadiness(),storage:store.activityCaptureStorage(workspaceId)}});
  handle('waypoint:activity-capture-list',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.listActivitySnapshots(text(value.workspaceId,'workspace ID',64),value.query==null?'':text(value.query,'activity capture query',100))});
  handle('waypoint:activity-capture-read',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.readActivitySnapshot(text(value.workspaceId,'workspace ID',64),text(value.snapshotId,'snapshot ID',64))});
  handle('waypoint:activity-capture-delete',(_event,input:unknown)=>{const value=input as Record<string,unknown>;store.deleteActivitySnapshot(text(value.workspaceId,'workspace ID',64),text(value.snapshotId,'snapshot ID',64));return{deleted:true}});
  handle('waypoint:activity-capture-delete-all',(_event,input:unknown)=>({deleted:store.deleteAllActivitySnapshots(text((input as Record<string,unknown>).workspaceId,'workspace ID',64))}));
  handle('waypoint:activity-capture-purge',(_event,input:unknown)=>({purged:store.purgeExpiredActivitySnapshots(text((input as Record<string,unknown>).workspaceId,'workspace ID',64))}));
  handle('waypoint:reflection-runs',(_event,input:unknown)=>store.listReflectionRuns(text((input as Record<string,unknown>).workspaceId,'workspace ID',64)));
  handle('waypoint:reflection-proposals',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.listReflectionProposals(text(value.workspaceId,'workspace ID',64),text(value.runId,'run ID',64))});
  handle('waypoint:reflection-start',async(_event,input:unknown)=>{
    const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),sourceIds=value.sourceIds,provider=value.provider==='claude'?'claude':'codex',reservation=`pending-${randomUUID()}`;
    if(store.toolGatewaySettings(workspaceId).stopped)throw new Error('Workspace stop is active');
    if(activeReflectionRuns.has(workspaceId))throw new Error('A reflection is already running in this workspace');
    if(!Array.isArray(sourceIds)||sourceIds.some((id)=>typeof id!=='string'))throw new Error('Reflection sources are invalid');
    activeReflectionRuns.set(workspaceId,reservation);
    let runId:string|undefined;
    try{
      const capability=await detectCli(provider);
      if(cancelledReflectionReservations.has(reservation))throw new Error('reflection_canceled:Canceled during capability detection');
      if(activeReflectionRuns.get(workspaceId)!==reservation)throw new Error('reflection_killed:Workspace stop became active during capability detection');
      if(store.toolGatewaySettings(workspaceId).stopped)throw new Error('reflection_killed:Workspace stop became active during capability detection');
      if(!capability.available||!capability.executable)throw new Error(`${provider} CLI is not signed in or available for local reflection`);
      if(capability.compatible===false)throw new Error(capability.compatibilityError);
      const sources=store.reflectionSourceEnvelope(workspaceId,sourceIds as string[]),serialized=JSON.stringify(sources);
      if(Buffer.byteLength(serialized)>500_000)throw new Error('Selected reflection sources exceed the bounded analysis envelope');
      const preliminary=store.createReflectionRun(workspaceId,sourceIds as string[],provider);runId=preliminary.runId;
      const profile=store.listSecurityProfiles(workspaceId).find((item)=>item.filesystem==='read-only'&&item.network==='provider-only'&&!item.tools.length);
      if(!profile)throw new Error('A read-only, provider-only, no-tools security profile is required for reflection');
      if(activeReflectionRuns.get(workspaceId)!==reservation||store.toolGatewaySettings(workspaceId).stopped)throw new Error('reflection_killed:Workspace stop became active before launch');
      activeReflectionRuns.set(workspaceId,runId);store.markReflectionRunReviewing(workspaceId,runId);
      const prompt=`You are Waypoint's bounded memory reflection reviewer. Analyze only the exact local sources below. Do not use tools, files, network, or outside facts. Return exactly one marker block and nothing else: <waypoint-reflection>[{"kind":"duplicate|stale|contradiction","title":"...","beforeBody":"...","proposedBody":"...","rationale":"...","sourceIds":["exact source IDs"]}]</waypoint-reflection>. Never choose a winner for a contradiction; leave proposedBody empty. Sources: ${serialized}`,events:ExecutionEvent[]=[];
      const execution=await workbench.start(`reflection-${runId}`,{cli:provider,prompt,workspaceRoot:profile.roots[0],profile:{...profile,maxConcurrency:1,secretNames:[]},executable:capability.executable,version:capability.version,timeoutMs:120_000,maxOutputBytes:262_144},(event)=>{if(event.type==='text'&&event.text)events.push(event)}),terminal=await execution.completion;
      if(terminal.status!=='completed')throw new Error(`reflection_${terminal.status}:${terminal.error??terminal.status}`);
      if(activeReflectionRuns.get(workspaceId)!==runId||cancelledReflectionReservations.has(runId))throw new Error('reflection_canceled:Reflection was canceled before proposals were applied');
      if(store.toolGatewaySettings(workspaceId).stopped||killedReflectionWorkspaces.has(workspaceId))throw new Error('reflection_killed:Workspace stop became active before proposals were applied');
      const output=events.map((event)=>event.text??'').join(''),matches=[...output.matchAll(/<waypoint-reflection>([\s\S]*?)<\/waypoint-reflection>/g)];
      if(matches.length!==1||output.trim()!==matches[0][0])throw new Error('Reflection CLI must return exactly one bounded proposal block');
      if(activeReflectionRuns.get(workspaceId)!==runId||store.toolGatewaySettings(workspaceId).stopped||killedReflectionWorkspaces.has(workspaceId)||cancelledReflectionReservations.has(runId))throw new Error(store.toolGatewaySettings(workspaceId).stopped||killedReflectionWorkspaces.has(workspaceId)?'reflection_killed:Workspace stop became active before apply':'reflection_canceled:Reflection was canceled before apply');
      return store.applyReflectionCliAnalysis(workspaceId,runId,provider,capability.version??'unknown',JSON.parse(matches[0][1]));
    }catch(error){const message=error instanceof Error?error.message:'Local reflection failed',status=killedReflectionWorkspaces.has(workspaceId)||message.startsWith('reflection_killed')?'killed':message.startsWith('reflection_canceled')?'cancelled':'failed';if(runId)store.failReflectionRun(workspaceId,runId,status,message);throw error}
    finally{if(activeReflectionRuns.get(workspaceId)===reservation||activeReflectionRuns.get(workspaceId)===runId)activeReflectionRuns.delete(workspaceId);killedReflectionWorkspaces.delete(workspaceId);cancelledReflectionReservations.delete(reservation);if(runId)cancelledReflectionReservations.delete(runId)}
  });
  handle('waypoint:reflection-cancel',(_event,input:unknown)=>{const workspaceId=text((input as Record<string,unknown>).workspaceId,'workspace ID',64),runId=activeReflectionRuns.get(workspaceId);if(!runId)return{canceled:false};cancelledReflectionReservations.add(runId);if(!runId.startsWith('pending-'))workbench.cancel(`reflection-${runId}`);return{canceled:true}});
  handle('waypoint:reflection-resolve',(_event,input:unknown)=>{const value=input as Record<string,unknown>,action=String(value.action);if(!['accept','edit','reject','rollback'].includes(action))throw new Error('Reflection action is invalid');return store.resolveReflectionProposal(text(value.workspaceId,'workspace ID',64),text(value.proposalId,'proposal ID',64),action as 'accept'|'edit'|'reject'|'rollback',value.editedBody==null?undefined:text(value.editedBody,'edited reflection',200000))});
  handle('waypoint:voice-capability',()=>crossPlatformVoiceCapability());
  handle('waypoint:voice-engine-status',async(_event,input:unknown)=>{const workspaceId=text((input as Record<string,unknown>).workspaceId,'workspace ID',64),preference=store.voicePreferences(workspaceId),experimental=voicePacks.status('full_duplex_experimental'),[ttsReady,sttReady]=await Promise.all([fastVoiceSpeech.probe(),fastVoiceTranscription.probe()]),ready=sttReady&&ttsReady;return{selected:preference.engine,engines:[{id:'fast_local' as const,label:'Fast Local',ready,version:'sherpa-onnx-1.13.4/whisper-tiny.en-int8/kitten-nano-en-v0.1-fp16',packageBytes:fastVoicePackageBytes,minimumRamBytes:1024**3,conversationOwner:'waypoint-providers' as const,install:'bundled' as const,reason:ready?'Bundled cross-platform Whisper transcription and Apache-licensed Kitten speech are verified and ready offline.':`${sttReady?'':'Bundled transcription failed its runtime probe. '}${ttsReady?'':'Bundled speech synthesis failed its runtime probe.'} Reinstall Waypoint.`,metrics:fastVoiceMetric?{firstAudioMs:fastVoiceMetric.firstAudioMs,interruptionMs:fastInterruptionMs,turnEndMs:fastVoiceMetric.generationMs,measuredAt:new Date().toISOString(),fixture:false}:fixtureVoiceMetrics([{atMs:300,durationMs:80},{atMs:380,durationMs:80}],400,445)},{...experimental,metrics:experimental.metrics.fixture?experimental.metrics:fixtureVoiceMetrics([{atMs:650,durationMs:80},{atMs:730,durationMs:80}],800,860)}]}});
  handle('waypoint:voice-configure',async()=>({canceled:false,capability:await crossPlatformVoiceCapability()}));
  handle('waypoint:voice-preferences',(_event,input:unknown)=>store.voicePreferences(text((input as Record<string,unknown>).workspaceId,'workspace ID',64)));
  handle('waypoint:voice-update-preferences',(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),engine=String(value.engine??store.voicePreferences(workspaceId).engine)as VoiceEngineId;if(engine==='full_duplex_experimental'&&!voicePacks.status(engine).ready)throw new Error('voice_engine_not_ready');return store.setVoicePreferences(workspaceId,{mode:String(value.mode),microphoneId:String(value.microphoneId??''),outputVoice:String(value.outputVoice),engine})});
  handle('waypoint:voice-remove-runtime',async()=>{voiceRuntime.remove();return{capability:await crossPlatformVoiceCapability()}});
  handle('waypoint:voice-transcribe',async(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),chatId=text(value.chatId,'chat ID',64),mode=value.mode==='hands_free'?'hands_free':'push_to_talk';if(store.toolGatewaySettings(workspaceId).stopped)throw new Error('voice_global_stop_active');const audio=value.audio;if(!(audio instanceof Uint8Array))throw new Error('voice_audio_invalid');const controller=voiceOperations.begin(workspaceId,chatId);store.recordVoiceActivity(workspaceId,chatId,'started',{mode});try{const result=await fastVoiceTranscription.transcribe(audio,controller.signal);if(controller.signal.aborted||store.toolGatewaySettings(workspaceId).stopped)throw new Error('voice_canceled');store.recordVoiceActivity(workspaceId,chatId,'transcribed',{mode,provider:result.provider});return{text:result.text,provider:result.provider}}catch(error){const code=controller.signal.aborted?'voice_canceled':voiceFailureCode(error);store.recordVoiceActivity(workspaceId,chatId,'failed',{mode,reason:code});throw new Error(code,{cause:error})}finally{voiceOperations.finish(workspaceId,chatId,controller);audio.fill(0)}});
  handle('waypoint:voice-speak',(event,input:unknown)=>{
    const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),chatId=text(value.chatId,'chat ID',64),turnId=Number(value.turnId),body=text(value.text,'speech text',200_000)
    if(!Number.isSafeInteger(turnId)||turnId<1)throw new Error('voice_turn_invalid');if(store.toolGatewaySettings(workspaceId).stopped)throw new Error('voice_global_stop_active');if(store.voicePreferences(workspaceId).engine!=='fast_local')throw new Error('voice_engine_not_ready')
    const previous=voiceSpeechOwner;if(previous){fastVoiceSpeech.stop();voiceSpeechOwner=undefined;if(!event.sender.isDestroyed())event.sender.send('waypoint:voice-audio-stop',{workspaceId:previous.workspaceId,chatId:previous.chatId,turnId:previous.turnId});previous.notify('canceled')}
    const owner={workspaceId,chatId,turnId,notify:(result:SpeechResult)=>{store.recordVoiceActivity(workspaceId,chatId,result==='failed'?'failed':'stopped',{reason:`tts_${result}`});if(!event.sender.isDestroyed())event.sender.send('waypoint:voice-speech-state',{workspaceId,chatId,turnId,result})}};voiceSpeechOwner=owner
    void fastVoiceSpeech.speak(body,(samples,sampleRate,index)=>{if(voiceSpeechOwner!==owner||event.sender.isDestroyed())return;event.sender.send('waypoint:voice-audio-chunk',{workspaceId,chatId,turnId,index,sampleRate,samples})}).then((metric)=>{if(voiceSpeechOwner!==owner)return;fastVoiceMetric=metric;if(metric.canceled)return;if(!event.sender.isDestroyed())event.sender.send('waypoint:voice-audio-end',{workspaceId,chatId,turnId})}).catch(()=>{if(voiceSpeechOwner!==owner)return;voiceSpeechOwner=undefined;owner.notify('failed')})
    return{speaking:true}
  });
  handle('waypoint:voice-playback-complete',(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),chatId=text(value.chatId,'chat ID',64),turnId=Number(value.turnId);const owner=voiceSpeechOwner;if(owner&&owner.workspaceId===workspaceId&&owner.chatId===chatId&&owner.turnId===turnId){voiceSpeechOwner=undefined;owner.notify('completed');return{completed:true}}return{completed:false}});
  handle('waypoint:voice-playback-stopped',(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),chatId=text(value.chatId,'chat ID',64),turnId=Number(value.turnId),key=`${workspaceId}:${chatId}:${turnId}`,started=voiceStopRequests.get(key);if(started===undefined)return{recorded:false};voiceStopRequests.delete(key);fastInterruptionMs=Math.max(0,performance.now()-started);return{recorded:true}});
  handle('waypoint:voice-stop',(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),chatId=text(value.chatId,'chat ID',64);voiceOperations.stop(workspaceId,chatId);if(voiceSpeechOwner?.workspaceId===workspaceId&&voiceSpeechOwner.chatId===chatId){const owner=voiceSpeechOwner;fastVoiceSpeech.stop();voiceSpeechOwner=undefined;recordVoiceStopRequest(`${workspaceId}:${chatId}:${owner.turnId}`);for(const window of BrowserWindow.getAllWindows())window.webContents.send('waypoint:voice-audio-stop',{workspaceId,chatId,turnId:owner.turnId})}store.recordVoiceActivity(workspaceId,chatId,'stopped',{reason:'user_stop'});return{stopped:true}});
  handle('waypoint:tool-gateway-capabilities',()=>{const settings=store.openRouterSettings(),capability=openRouterCapability(settings,providerKeyConfigured(),store.providerUsage().summary);return{version:1,tools:toolGateway.descriptors(),localClis:[discoverLocalCli('git'),discoverLocalCli('gh'),discoverLocalCli('az')],browser:{available:false,profiles:['existing','isolated'],reason:'Browser control is a typed future seam and is not active.'},remoteProviders:{available:capability.available,provider:'openrouter',state:capability.state,health:capability.health,reason:capability.reason},crossDevice:{available:true,reason:'User-dispatched workspace summary jobs are available when encrypted sync and target worker policy are enabled.'}}});
  handle('waypoint:openrouter-status',()=>{const settings=store.openRouterSettings(),usage=store.providerUsage(),keyConfigured=providerKeyConfigured(),base=openRouterCapability(settings,keyConfigured,usage.summary),latest=usage.receipts[0],capability=latest?.status==='completed'&&base.available?{...base,health:'verified' as const,reason:'Configured and last authorized request completed; current model availability is rechecked per request.'}:latest?.status==='failed'&&base.available?{...base,health:'failed' as const,reason:'The last authorized hosted request failed; no background health call is made.'}:base;return{settings,keyConfigured,capability,usage}});
  handle('waypoint:openrouter-set-key',(_event,input:unknown)=>{providerVault.setKey(text((input as Record<string,unknown>).apiKey,'OpenRouter API key',512));return{keyConfigured:true}});
  handle('waypoint:openrouter-remove-key',()=>{providerVault.removeKey();const current=store.openRouterSettings();store.setOpenRouterSettings({...current,liveRequestsEnabled:false});return{keyConfigured:false}});
  handle('waypoint:openrouter-update-settings',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.setOpenRouterSettings({enabled:value.enabled===true,liveRequestsEnabled:value.liveRequestsEnabled===true,strategicModel:text(value.strategicModel,'strategic model ID',200),everydayModel:text(value.everydayModel,'everyday model ID',200),fallbackProvider:['codex','claude'].includes(String(value.fallbackProvider))?value.fallbackProvider as 'codex'|'claude':undefined,monthlyCapMicros:Number(value.monthlyCapMicros),ytdCapMicros:Number(value.ytdCapMicros),perRequestCapMicros:Number(value.perRequestCapMicros),warningPercent:Number(value.warningPercent)})});
  handle('waypoint:run-openrouter-chat',async(_event,input:unknown)=>{
    const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),chatId=text(value.chatId,'chat ID',64),sourceMessageId=text(value.sourceMessageId,'source message ID',64),prompt=text(value.prompt,'prompt',2_000_000),role=value.role==='strategic'?'strategic' as const:'everyday' as const;
    if(Array.isArray(value.attachmentIds)&&value.attachmentIds.length)throw new Error('OpenRouter attachments are not enabled; files remain local.');
    const settings=store.openRouterSettings(),usage=store.providerUsage(),apiKey=providerVault.getKey(),subscriptions=(await Promise.all([detectCli('codex'),detectCli('claude')])).filter((item)=>item.available&&item.compatible!==false).map((item)=>item.name),fallback=(provider:'codex'|'claude',reason:string)=>{const timestamp=new Date().toISOString(),receipt:ProviderUsageReceipt={id:randomUUID(),workspaceId,provider:'openrouter',model:role==='strategic'?settings.strategicModel:settings.everydayModel,role,status:'blocked',costMicros:0,promptTokens:0,completionTokens:0,requestDigest:createHash('sha256').update(`fallback:${workspaceId}:${sourceMessageId}`).digest('hex'),fallbackProvider:provider,errorCode:'cap_fallback',startedAt:timestamp,finishedAt:timestamp};store.saveProviderUsage(receipt);return{fallbackProvider:provider,reason}};
    const route=decideHostedRoute({settings,keyConfigured:true,summary:usage.summary,role,availableSubscriptions:subscriptions});
    if(route.provider!=='openrouter')return fallback(route.provider,route.reason);
    let release:()=>void;try{release=openRouterBudget.reserve(settings,usage.summary)}catch(error){const provider=settings.fallbackProvider;if(provider&&subscriptions.includes(provider))return fallback(provider,'A concurrent hosted request reserved the remaining cap; using the pre-approved subscription fallback.');throw error}
    const runId=store.createHostedRun(workspaceId,chatId,sourceMessageId,role,route.model!),controller=new AbortController();activeHostedRuns.set(runId,{workspaceId,controller});store.startHostedRun(workspaceId,runId);
    void openRouterClient.run({workspaceId,role,model:route.model!,prompt,apiKey,signal:controller.signal,requestCapMicros:settings.perRequestCapMicros??100_000}).then(({text:answer,receipt})=>store.finishHostedRun(workspaceId,runId,'completed',receipt,answer)).catch((error:Error&{receipt?:ProviderUsageReceipt})=>{const receipt=error.receipt;if(receipt)store.finishHostedRun(workspaceId,runId,receipt.status==='canceled'?'canceled':'failed',receipt)}).finally(()=>{release();activeHostedRuns.delete(runId)});
    return{runId,status:'running',model:route.model}
  });
  handle('waypoint:cancel-openrouter-run',(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),runId=text(value.runId,'hosted run ID',64),active=activeHostedRuns.get(runId);if(!active||active.workspaceId!==workspaceId)return{canceled:false};active.controller.abort();return{canceled:true}});
  handle('waypoint:tool-gateway-settings',(event,input:unknown)=>{const workspaceId=text((input as Record<string,unknown>).workspaceId,'workspace ID',64);toolWindowWorkspaces.set(event.sender.id,workspaceId);event.sender.once('destroyed',()=>toolWindowWorkspaces.delete(event.sender.id));return store.toolGatewaySettings(workspaceId)});
  handle('waypoint:tool-gateway-update-settings',(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),denyPatterns=Array.isArray(value.denyPatterns)?value.denyPatterns.map((item)=>text(item,'deny pattern',300)):[],next={stopped:value.stopped===true,denyPatterns,suppressCommit:value.suppressCommit===true,suppressPush:value.suppressPush===true};validatePolicy({...gatewayPolicy(workspaceId),...next});if(next.stopped){toolGateway.stop(workspaceId);const reflectionRun=activeReflectionRuns.get(workspaceId);if(reflectionRun){killedReflectionWorkspaces.add(workspaceId);workbench.cancel(`reflection-${reflectionRun}`)}store.cancelAllRemoteJobs(workspaceId);voiceOperations.stop(workspaceId);if(voiceSpeechOwner?.workspaceId===workspaceId){const owner=voiceSpeechOwner;fastVoiceSpeech.stop();voiceSpeechOwner=undefined;for(const window of BrowserWindow.getAllWindows())window.webContents.send('waypoint:voice-audio-stop',{workspaceId,chatId:owner.chatId,turnId:owner.turnId});owner.notify('canceled')}const capture=store.activityCapturePolicy(workspaceId);if(capture.enabled&&!capture.paused)store.setActivityCapturePolicy(workspaceId,{...capture,paused:true})}else toolGateway.resume(workspaceId);return store.setToolGatewaySettings(workspaceId,next)});
  handle('waypoint:tool-gateway-receipts',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.listToolReceipts(text(value.workspaceId,'workspace ID',64),Number(value.limit??100))});
  handle('waypoint:tool-failures',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.listToolFailures(text(value.workspaceId,'workspace ID',64),Number(value.limit??100))});
  handle('waypoint:delete-tool-failure',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return{deleted:store.deleteToolFailure(text(value.workspaceId,'workspace ID',64),text(value.id,'failure knowledge ID',64))}});
  handle('waypoint:tool-gateway-execute',async(event,input:unknown)=>{const request=input as ToolRequest,workspaceId=text(request?.workspaceId,'workspace ID',64);toolWindowWorkspaces.set(event.sender.id,workspaceId);return toolGateway.execute({...request,origin:'ui'},gatewayPolicy(workspaceId))});
  handle('waypoint:tool-gateway-cancel',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return{canceled:toolGateway.cancel(text(value.workspaceId,'workspace ID',64),text(value.runId,'tool run ID',64))}});
  handle('waypoint:create-workspace', (_event, input: unknown) => {
    const name = text((input as { name?: unknown })?.name, 'workspace name', 120).trim();
    if (!name) throw new Error('Workspace name is required');
    return store.createWorkspace(name, app.getPath('userData'));
  });
  handle('waypoint:create-document', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.createDocument(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000));
  });
  handle('waypoint:capture-message-as-document', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.captureMessageAsDocument(text(value.workspaceId, 'workspace ID', 64), text(value.messageId, 'message ID', 64));
  });
  handle('waypoint:update-document', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.updateDocument(text(value.workspaceId, 'workspace ID', 64), text(value.objectId, 'document ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000));
  });
  handle('waypoint:list-documents', (_event, input: unknown) => store.listDocuments(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:import-document',async(_event,input:unknown)=>{const workspaceId=text((input as Record<string,unknown>).workspaceId,'workspace ID',64);if(!store.listWorkspaces().some((item)=>item.id===workspaceId))throw new Error('Workspace not found');const chosen=await dialog.showOpenDialog({title:'Import local document',properties:['openFile'],filters:[{name:'Documents',extensions:['pdf','docx','txt','md','markdown']}]});if(chosen.canceled||!chosen.filePaths[0])return{canceled:true};const sourcePath=chosen.filePaths[0],mediaType=ATTACHMENT_MEDIA_BY_EXTENSION[path.extname(sourcePath).toLowerCase()];if(!mediaType||mediaType.startsWith('image/'))throw new Error('This file type has no approved local text extractor');readAndValidateAttachment(sourcePath,path.basename(sourcePath),mediaType);const extracted=await extractDocumentOffMain(sourcePath,mediaType);if(extracted.status==='failed')return{canceled:false,state:'failed',code:extracted.code,message:extracted.message};const title=path.basename(extracted.fileName,path.extname(extracted.fileName)).slice(0,300)||'Imported document',document=store.createDocument(workspaceId,title,extracted.text);let attachmentId:string;try{attachmentId=store.addAttachment(workspaceId,document.id,extracted.fileName,mediaType,sourcePath);store.registerDocumentImportSource(workspaceId,{documentId:document.id,revisionId:document.revisionId,attachmentId,sourceDigest:extracted.sourceDigest,textDigest:createHash('sha256').update(extracted.text).digest('hex'),extractor:extracted.extractor,extractorVersion:extracted.extractorVersion});const stored=store.documentSource(workspaceId,document.id);if(stored.metadata.sha256!==extracted.sourceDigest)throw new Error('The selected file changed during import')}catch(error){store.deleteObject(workspaceId,'document',document.id);throw error}const base={canceled:false,documentId:document.id,revisionId:document.revisionId,attachmentId,sourceName:extracted.fileName,extractor:extracted.extractor,extractorVersion:extracted.extractorVersion,warnings:extracted.warnings};try{return{...base,...await indexImportedDocument(workspaceId,document.id,document.revisionId,attachmentId,extracted.chunks)}}catch{return{...base,state:'index_failed' as const,chunkCount:extracted.chunks.length,provider:embeddings.provider,model:embeddings.model,message:'The document was imported for lexical search, but local semantic indexing failed. Retry from Knowledge after checking the local embedding runtime.'}}});
  handle('waypoint:reindex-imported-document',async(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),documentId=text(value.documentId,'document ID',64),document=store.listDocuments(workspaceId).find((item)=>item.id===documentId);if(!document)throw new Error('Document not found in workspace');const source=store.documentSource(workspaceId,documentId),extracted=await extractDocumentOffMain(source.absolutePath,source.metadata.mediaType);if(extracted.status==='failed')return{state:extracted.code==='busy'?'index_busy':'index_failed',chunkCount:0,provider:embeddings.provider,model:embeddings.model,message:extracted.message};if(extracted.sourceDigest!==source.metadata.sha256||extracted.text!==document.body)return{state:'source_changed',chunkCount:extracted.chunks.length,provider:embeddings.provider,model:embeddings.model,message:'This document was edited after import. Reindexing the original source would create false provenance; import the edited file as a new document instead.'};try{return await indexImportedDocument(workspaceId,documentId,document.revisionId,source.metadata.id,extracted.chunks)}catch{return{state:'index_failed',chunkCount:extracted.chunks.length,provider:embeddings.provider,model:embeddings.model,message:'Local semantic indexing failed without replacing the last complete index generation.'}}});
  handle('waypoint:document-index-status',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.documentIndexStatus(text(value.workspaceId,'workspace ID',64),text(value.documentId,'document ID',64))});
  handle('waypoint:rollback-document-index',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.rollbackDocumentIndex(text(value.workspaceId,'workspace ID',64),text(value.documentId,'document ID',64))});
  handle('waypoint:sync-status', (_event, input: unknown) => sanitizeSyncStatus(store.syncStatus(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64))));
  handle('waypoint:desktop-sync-status', (_event, input: unknown) => syncService.status(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:desktop-sync-initialize', async (_event, input: unknown) => {
    const workspaceId = text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64);
    if (!store.listWorkspaces().some((item) => item.id === workspaceId)) throw new Error('Workspace not found');
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Create protected sync identity', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Set up this Mac as the first sync owner?',
      detail: 'This creates local protected keys. An authorized operator must register the displayed public bootstrap bundle before sync connects.',
    });
    if (confirmation.response !== 0) return { canceled: true };
    const bootstrap = syncService.initializeOwner(workspaceId);
    store.configureSyncDevice(workspaceId, bootstrap.deviceId);
    recordSyncActivityBestEffort(store, workspaceId, 'device.initialized');
    return { canceled: false, bootstrap };
  });
  handle('waypoint:desktop-sync-create-invitation', async (_event, input: unknown) => syncService.createInvitation(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:desktop-sync-submit-enrollment', async (_event, input: unknown) => syncService.submitEnrollment(text((input as Record<string, unknown>).token, 'enrollment token', 8192)));
  handle('waypoint:desktop-sync-complete-enrollment', async (_event, input: unknown) => {
    const workspaceId = text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64),
      result = await syncService.completeEnrollment(workspaceId);
    store.configureSyncDevice(workspaceId, result.deviceId);
    recordSyncActivityBestEffort(store, workspaceId, 'device.enrolled');
    return result;
  });
  handle('waypoint:desktop-sync-pending', async (_event, input: unknown) => syncService.pendingEnrollments(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:desktop-sync-approve', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, 'workspace ID', 64),
      requestId = text(value.requestId, 'request ID', 64),
      confirmation = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Approve device', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: 'Approve this device for workspace sync?',
        detail: 'The device will receive a wrapped copy of the workspace key and request a fresh encrypted workspace snapshot after enrollment.',
      });
    if (confirmation.response !== 0) return { canceled: true };
    const result = await syncService.approveEnrollment(workspaceId, requestId);
    recordSyncActivityBestEffort(store, workspaceId, 'device.approved');
    return { canceled: false, ...result };
  });
  handle('waypoint:desktop-sync-devices', async (_event, input: unknown) => syncService.devices(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:desktop-sync-revoke', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, 'workspace ID', 64),
      deviceId = text(value.deviceId, 'device ID', 64),
      confirmation = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Revoke and rotate', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: 'Revoke this device?',
        detail: 'The device will lose relay access immediately. Waypoint will rotate the workspace key for remaining devices.',
      });
    if (confirmation.response !== 0) return { canceled: true };
    await syncService.revoke(workspaceId, deviceId);
    const rotation = await syncService.rotate(workspaceId);
    recordSyncActivityBestEffort(store, workspaceId, 'device.revoked');
    recordSyncActivityBestEffort(store, workspaceId, 'key.rotated');
    return { canceled: false, rotation };
  });
  handle('waypoint:desktop-sync-resume-rotation', async (_event, input: unknown) => {
    const workspaceId = text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64),
      result = await syncService.rotate(workspaceId);
    recordSyncActivityBestEffort(store, workspaceId, 'key.rotated');
    return result;
  });
  handle('waypoint:desktop-sync-now', async (_event, input: unknown) => {
    const workspaceId = text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64),
      result = await syncService.syncOnce(workspaceId, store);
    await processRemoteJobs(workspaceId);
    recordSyncActivityBestEffort(store, workspaceId, 'sync.completed', {
      status: 'completed',
    });
    return result;
  });
  handle('waypoint:device-control-status',(_event,input:unknown)=>{const workspaceId=text((input as Record<string,unknown>).workspaceId,'workspace ID',64);return{policy:store.deviceControlPolicy(workspaceId),jobs:store.listRemoteJobs(workspaceId),sync:syncService.status(workspaceId),capabilities:[{id:'waypoint.workspace_summary',available:true,label:'Workspace summary'},{id:'agent.codex',available:false,label:'Codex agent',reason:'Remote CLI agent delegation is not enabled in this bounded slice.'},{id:'agent.claude',available:false,label:'Claude agent',reason:'Remote CLI agent delegation is not enabled in this bounded slice.'}]}});
  handle('waypoint:device-control-update',async(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),current=store.deviceControlPolicy(workspaceId),next={...current,...(value.policy as Record<string,unknown>),version:1};if(JSON.stringify(next)!==JSON.stringify(current)){const confirmation=await dialog.showMessageBox({type:'warning',buttons:['Apply device policy','Cancel'],defaultId:1,cancelId:1,message:'Change trusted device execution policy?',detail:'Worker enablement, failover, capability, preference, and execution limits are security-critical. Jobs remain limited to the capabilities shown in Waypoint.'});if(confirmation.response!==0)return{canceled:true,policy:current}}return{canceled:false,policy:store.setDeviceControlPolicy(workspaceId,next as never)}});
  handle('waypoint:device-control-dispatch',(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),targetDeviceId=text(value.targetDeviceId,'target device ID',128),instruction=text(value.instruction,'remote instruction',8000),sync=syncService.status(workspaceId);if(!sync.configured||!sync.deviceId)throw new Error('Device sync is not configured');return store.createRemoteJobRecord({workspaceId,controllerDeviceId:sync.deviceId,targetDeviceId,capability:'waypoint.workspace_summary',instruction,idempotencyKey:text(value.idempotencyKey,'idempotency key',128),profileDigest:remotePolicyDigest('waypoint.workspace_summary'),keyEpoch:sync.keyEpoch,timeoutMs:60_000})});
  handle('waypoint:device-control-cancel',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return{canceled:store.cancelRemoteJob(text(value.workspaceId,'workspace ID',64),text(value.jobId,'remote job ID',128))}});
  handle('waypoint:device-control-delete',(_event,input:unknown)=>{const value=input as Record<string,unknown>;store.deleteRemoteJob(text(value.workspaceId,'workspace ID',64),text(value.jobId,'remote job ID',128));return{deleted:true}});
  handle('waypoint:webhook-channels',async(_event,input:unknown)=>syncService.webhookChannels(text((input as Record<string,unknown>).workspaceId,'workspace ID',64)));
  handle('waypoint:webhook-channel-create',async(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),label=text(value.label,'channel label',80).trim();if(!label)throw new Error('Channel label is required');return syncService.createWebhookChannel(workspaceId,label)});
  handle('waypoint:webhook-channel-rotate',async(_event,input:unknown)=>{const value=input as Record<string,unknown>;return syncService.rotateWebhookChannel(text(value.workspaceId,'workspace ID',64),text(value.channelId,'channel ID',128))});
  handle('waypoint:webhook-channel-revoke',async(_event,input:unknown)=>{const value=input as Record<string,unknown>;return syncService.revokeWebhookChannel(text(value.workspaceId,'workspace ID',64),text(value.channelId,'channel ID',128))});
  handle('waypoint:webhook-channel-delete',async(_event,input:unknown)=>{const value=input as Record<string,unknown>;return syncService.deleteWebhookChannel(text(value.workspaceId,'workspace ID',64),text(value.channelId,'channel ID',128))});
  handle('waypoint:webhook-kill',async(_event,input:unknown)=>{const value=input as Record<string,unknown>;if(typeof value.active!=='boolean')throw new Error('Kill state is invalid');return syncService.setWebhookKill(text(value.workspaceId,'workspace ID',64),value.active)});
  handle('waypoint:webhook-fetch',async(_event,input:unknown)=>{const workspaceId=text((input as Record<string,unknown>).workspaceId,'workspace ID',64);return syncService.fetchWebhookEvents(workspaceId,store)});
  handle('waypoint:webhook-events',(_event,input:unknown)=>store.listExternalInboundEvents(text((input as Record<string,unknown>).workspaceId,'workspace ID',64)));
  handle('waypoint:webhook-event-delete',(_event,input:unknown)=>{const value=input as Record<string,unknown>;store.deleteExternalInboundEvent(text(value.workspaceId,'workspace ID',64),text(value.eventId,'event ID',128));return{ok:true}});
  handle('waypoint:search-text', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    const workspaceId = text(value.workspaceId, 'workspace ID', 64);
    return store.searchText(workspaceId, text(value.query, 'query', 500));
  });
  handle('waypoint:search-semantic', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, 'workspace ID', 64);
    const embedded = await embeddings.embed([text(value.query, 'query', 2_000)]);
    const provenance={
      provider: embeddings.provider,
      providerVersion: embeddings.providerVersion,
      model: embeddings.model,
      modelDigest: embedded.modelDigest,
      chunkingDigest: activeChunkingProvenance};
    const ordinary=store.semanticSearch(workspaceId,embedded.vectors[0],provenance),documents=store.semanticSearch(workspaceId,embedded.vectors[0],{...provenance,chunkingDigest:documentChunkingDigest});return[...ordinary,...documents].sort((left,right)=>right.score-left.score).filter((item,index,all)=>all.findIndex((candidate)=>candidate.objectId===item.objectId&&candidate.revisionId===item.revisionId)===index).slice(0,20);
  });
  handle('waypoint:index-document', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, 'workspace ID', 64),
      objectId = text(value.objectId, 'document ID', 64);
    const document = store.listDocuments(workspaceId).find((candidate) => candidate.id === objectId);
    if (!document) throw new Error('Document not found in workspace');
    const embedded = await embeddings.embed([`${document.title}\n\n${document.body}`]);
    store.indexEmbedding(workspaceId, { objectId, objectKind: 'document', revisionId: document.revisionId }, embedded.vectors[0], {
      provider: embeddings.provider,
      providerVersion: embeddings.providerVersion,
      model: embeddings.model,
      modelDigest: embedded.modelDigest,
      chunkingDigest: activeChunkingProvenance,
    });
    return {
      ok: true,
      model: embeddings.model,
      modelDigest: embedded.modelDigest,
    };
  });
  handle('waypoint:delete-document', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteObject(text(value.workspaceId, 'workspace ID', 64), 'document', text(value.objectId, 'document ID', 64));
    return { ok: true };
  });
  handle('waypoint:delete-object', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      kind = text(value.kind, 'object kind', 20),
      workspaceId = text(value.workspaceId, 'workspace ID', 64),
      objectId = text(value.objectId, 'object ID', 64);
    if (!['document', 'chat', 'memory'].includes(kind)) throw new Error('Invalid deletable object kind');
    deleteWithExecutionCancellation(store, workbench, workspaceId, kind as 'document' | 'chat' | 'memory', objectId);
    return { ok: true };
  });
  handle('waypoint:attach-document', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, 'workspace ID', 64),
      objectId = text(value.objectId, 'document ID', 64);
    const chosen = await dialog.showOpenDialog({
      title: 'Attach text to note',
      properties: ['openFile'],
      filters: [{ name: 'Text and Markdown', extensions: ['txt', 'md', 'markdown'] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
    const sourcePath = chosen.filePaths[0],
      extension = path.extname(sourcePath).toLowerCase();
    const mediaType = extension === '.md' || extension === '.markdown' ? 'text/markdown' : 'text/plain';
    return {
      canceled: false,
      attachmentId: store.addAttachment(workspaceId, objectId, path.basename(sourcePath), mediaType, sourcePath),
    };
  });
  handle('waypoint:select-chat-attachments', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, 'workspace ID', 64),
      chatId = text(value.chatId, 'chat ID', 64);
    const chosen = await dialog.showOpenDialog({
      title: 'Attach files to chat',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Chat attachments',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'docx', 'txt', 'md', 'markdown'],
        },
      ],
    });
    if (chosen.canceled)
      return {
        canceled: true,
        attachments: store.listChatAttachments(workspaceId, chatId),
      };
    const existing = store.listChatAttachments(workspaceId, chatId).filter((attachment) => attachment.ownerId === chatId).length;
    if (existing + chosen.filePaths.length > MAX_ATTACHMENTS_PER_OWNER) throw new Error(`A chat message can queue no more than ${MAX_ATTACHMENTS_PER_OWNER} files`);
    const validated = chosen.filePaths.map((sourcePath) => {
        const mediaType = ATTACHMENT_MEDIA_BY_EXTENSION[path.extname(sourcePath).toLowerCase()];
        if (!mediaType) throw new Error('Unsupported chat attachment type');
        readAndValidateAttachment(sourcePath, path.basename(sourcePath), mediaType);
        return { sourcePath, mediaType };
      }),
      added: string[] = [];
    try {
      for (const item of validated) added.push(store.addAttachment(workspaceId, chatId, path.basename(item.sourcePath), item.mediaType, item.sourcePath));
    } catch (error) {
      for (const attachmentId of added)
        try {
          store.deleteAttachment(workspaceId, attachmentId);
        } catch {
          /* Best-effort rollback preserves the original picker error. */
        }
      throw error;
    }
    return {
      canceled: false,
      attachments: store.listChatAttachments(workspaceId, chatId),
    };
  });
  handle('waypoint:list-chat-attachments', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.listChatAttachments(text(value.workspaceId, 'workspace ID', 64), text(value.chatId, 'chat ID', 64));
  });
  handle('waypoint:delete-attachment', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteAttachment(text(value.workspaceId, 'workspace ID', 64), text(value.attachmentId, 'attachment ID', 64));
    return { ok: true };
  });
  handle('waypoint:graph', (_event, input: unknown) => store.graph(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:activity', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      families = Array.isArray(value.families) ? (value.families.map((item) => text(item, 'activity family', 20)) as import('./core/types.js').ActivityFamily[]) : undefined,
      query = value.query === undefined ? undefined : text(value.query, 'activity query', 100);
    return store.listActivity(text(value.workspaceId, 'workspace ID', 64), {
      families,
      query,
      limit: value.limit === undefined ? undefined : Number(value.limit),
    });
  });
  handle('waypoint:create-meeting', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    if (value.consentAcknowledged !== true) throw new Error('Recording consent must be acknowledged for this session');
    return {
      meetingId: store.createMeeting(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'meeting title', 300)),
    };
  });
  handle('waypoint:finalize-meeting', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, 'workspace ID', 64),
      meetingId = text(value.meetingId, 'meeting ID', 64),
      mediaType = text(value.mediaType, 'meeting media type', 40);
    if (!(value.audio instanceof Uint8Array)) throw new Error('Meeting audio payload is invalid');
    const bytes = Buffer.from(value.audio),
      disk = statfsSync(app.getPath('userData')),
      free = Number(disk.bavail) * Number(disk.bsize);
    if (free < bytes.length + 256 * 1024 * 1024) {
      store.failMeeting(workspaceId, meetingId, 'disk_pressure');
      throw new Error('Not enough free space to save this recording');
    }
    try {
      store.finalizeMeetingAudio(workspaceId, meetingId, mediaType, bytes);
    } catch (error) {
      store.failMeeting(workspaceId, meetingId, 'capture_failed');
      throw error;
    }
    return { ok: true };
  });
  handle('waypoint:fail-meeting', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      code = text(value.failureCode, 'meeting failure code', 40);
    if (!['permission_denied', 'device_lost', 'interrupted', 'disk_pressure', 'capture_failed', 'size_limit'].includes(code)) throw new Error('Meeting failure code is invalid');
    store.failMeeting(text(value.workspaceId, 'workspace ID', 64), text(value.meetingId, 'meeting ID', 64), code as 'permission_denied' | 'device_lost' | 'interrupted' | 'disk_pressure' | 'capture_failed' | 'size_limit');
    return { ok: true };
  });
  handle('waypoint:list-meetings', (_event, input: unknown) => store.listMeetings(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:update-meeting-transcript', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.updateMeetingTranscript(text(value.workspaceId, 'workspace ID', 64), text(value.meetingId, 'meeting ID', 64), text(value.transcript, 'meeting transcript', 500_000), value.reviewed === true);
    return { ok: true };
  });
  handle('waypoint:save-meeting-memory', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return {
      memoryId: store.saveMeetingTranscriptToMemory(text(value.workspaceId, 'workspace ID', 64), text(value.meetingId, 'meeting ID', 64)),
    };
  });
  handle('waypoint:delete-meeting', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteMeeting(text(value.workspaceId, 'workspace ID', 64), text(value.meetingId, 'meeting ID', 64));
    return { ok: true };
  });
  handle('waypoint:read-meeting-audio', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      audio = store.meetingAudio(text(value.workspaceId, 'workspace ID', 64), text(value.meetingId, 'meeting ID', 64));
    return { mediaType: audio.mediaType, audio: readFileSync(audio.path) };
  });
  handle('waypoint:export-meeting-audio', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      audio = store.meetingAudio(text(value.workspaceId, 'workspace ID', 64), text(value.meetingId, 'meeting ID', 64)),
      extension = audio.mediaType === 'audio/webm' ? 'webm' : audio.mediaType === 'audio/mp4' ? 'm4a' : audio.mediaType === 'audio/ogg' ? 'ogg' : 'wav',
      chosen = await dialog.showSaveDialog({
        title: 'Export local meeting audio',
        defaultPath: `${audio.title.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 80)}.${extension}`,
      });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    writeFileSync(chosen.filePath, readFileSync(audio.path), {
      flag: 'wx',
      mode: 0o600,
    });
    return { canceled: false };
  });
  handle('waypoint:meeting-transcription-capability', () => ({
    available: false,
    provider: 'local-whisper',
    reason: 'No reviewed packaged local transcription model is configured. Audio will not be uploaded or sent to a CLI. You can enter and review a transcript draft manually.',
  }));
  handle('waypoint:create-local-webhook-fixture',(_event,input:unknown)=>{const value=input as Record<string,unknown>,payload=value.payload;if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Local fixture payload is invalid');return{eventId:store.createLocalWebhookFixture(text(value.workspaceId,'workspace ID',64),text(value.eventType,'event type',80),text(value.idempotencyKey,'idempotency key',128),payload as Record<string,string|number|boolean|null>)}});
  handle('waypoint:list-local-trigger-lab',(_event,input:unknown)=>store.listLocalTriggerLab(text((input as Record<string,unknown>).workspaceId,'workspace ID',64)));
  handle('waypoint:approve-local-trigger-rule',(_event,input:unknown)=>{const value=input as Record<string,unknown>;store.approveLocalTriggerRule(text(value.workspaceId,'workspace ID',64),text(value.ruleId,'rule ID',64));return{ok:true}});
  handle('waypoint:dry-run-local-trigger-rule',(_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.dryRunLocalTriggerRule(text(value.workspaceId,'workspace ID',64),text(value.ruleId,'rule ID',64),value.simulateFailure===true)});
  handle('waypoint:set-local-trigger-kill',(_event,input:unknown)=>{const value=input as Record<string,unknown>;store.setLocalTriggerKillSwitch(text(value.workspaceId,'workspace ID',64),value.enabled===true);return{ok:true}});
  handle('waypoint:delete-local-trigger-event',(_event,input:unknown)=>{const value=input as Record<string,unknown>;store.deleteLocalTriggerEvent(text(value.workspaceId,'workspace ID',64),text(value.eventId,'event ID',64));return{ok:true}});
  handle('waypoint:create-fixture-playbook', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      hour = Number(value.hour),
      minute = Number(value.minute);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error('Playbook time is invalid');
    return {
      playbookId: store.createFixturePlaybook(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'playbook title', 200), text(value.timezone, 'timezone', 100), hour, minute),
    };
  });
  handle('waypoint:list-fixture-playbooks', (_event, input: unknown) => store.listFixturePlaybooks(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:dry-run-fixture-playbook', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.dryRunFixturePlaybook(text(value.workspaceId, 'workspace ID', 64), text(value.playbookId, 'playbook ID', 64));
  });
  handle('waypoint:run-fixture-playbook', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.runFixturePlaybook(text(value.workspaceId, 'workspace ID', 64), text(value.playbookId, 'playbook ID', 64), text(value.dryRunDigest, 'dry-run digest', 128), value.simulateFailure === true);
  });
  handle('waypoint:kill-fixture-playbook', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.killFixturePlaybook(text(value.workspaceId, 'workspace ID', 64), text(value.playbookId, 'playbook ID', 64));
    return { ok: true };
  });
  handle('waypoint:delete-fixture-playbook', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteFixturePlaybook(text(value.workspaceId, 'workspace ID', 64), text(value.playbookId, 'playbook ID', 64));
    return { ok: true };
  });
  handle('waypoint:list-chats', (_event, input: unknown) => store.listChats(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:cli-capabilities', async () => Promise.all([detectCli('codex'), detectCli('claude')]));
  handle('waypoint:cli-model-catalog',async()=>installedCliModelCatalog(await Promise.all([detectCli('codex'),detectCli('claude')])));
  handle('waypoint:chat-model-preferences',(_event,input:unknown)=>store.chatModelPreferences(text((input as Record<string,unknown>).workspaceId,'workspace ID',64)));
  handle('waypoint:chat-model-preference',(_event,input:unknown)=>{const value=input as Record<string,unknown>;if(!['codex','claude'].includes(String(value.provider)))throw new Error('Chat provider is invalid');return store.setChatModelPreference(text(value.workspaceId,'workspace ID',64),value.provider as'codex'|'claude',String(value.model??''))});
  handle('waypoint:propose-chat-route',async(_event,input:unknown)=>{const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),chatId=text(value.chatId,'chat ID',64),preferred=text(value.preferred,'preferred provider',20);if(!['codex','claude'].includes(preferred))throw new Error('Unsupported preferred provider');const profileId=text(value.securityProfileId,'security profile ID',64);if(!store.listSecurityProfiles(workspaceId).some((item)=>item.id===profileId))throw new Error('Security profile not found');const ids=Array.isArray(value.attachmentIds)?value.attachmentIds.map((item)=>text(item,'attachment ID',64)):[],available=new Map(store.listChatAttachments(workspaceId,chatId).map((item)=>[item.id,item]));if(ids.some((id)=>!available.has(id)))throw new Error('Attachment not found in chat');return proposeRoute({capabilities:await Promise.all([detectCli('codex'),detectCli('claude')]),preferred:preferred as 'codex'|'claude',allowFallback:value.allowFallback===true,securityProfileId:profileId,attachments:ids.map((id)=>({id,mediaType:available.get(id)!.mediaType,bytes:available.get(id)!.bytes}))})});
  handle('waypoint:list-security-profiles', (_event, input: unknown) => store.listSecurityProfiles(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:list-executions', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    const workspaceId=text(value.workspaceId,'workspace ID',64),chatId=value.chatId?text(value.chatId,'chat ID',64):undefined;return[...store.listExecutions(workspaceId,chatId),...store.listHostedRuns(workspaceId,chatId)];
  });
  handle('waypoint:run-chat', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, 'workspace ID', 64),
      chatId = text(value.chatId, 'chat ID', 64);
    const cli = text(value.cli, 'CLI', 20);
    if (!['codex', 'claude'].includes(cli)) throw new Error('Unsupported CLI');
    let prompt = text(value.prompt, 'prompt', 2_000_000);
    const profileId = text(value.securityProfileId, 'security profile ID', 64),
      parentExecutionId = value.parentExecutionId ? text(value.parentExecutionId, 'parent execution ID', 64) : undefined;
    const sourceMessageId = text(value.sourceMessageId, 'source message ID', 64),
      attachmentIds = Array.isArray(value.attachmentIds) ? value.attachmentIds.map((item) => text(item, 'attachment ID', 64)) : [];
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_OWNER || new Set(attachmentIds).size !== attachmentIds.length) throw new Error('Invalid chat attachment selection');
    const workspace = store.listWorkspaces().find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const profile = store.listSecurityProfiles(workspaceId).find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error('Security profile not found');
    let childTask:ChildTaskManifest|undefined;if(parentExecutionId){childTask=createChildTask({type:text(value.taskType,'child task type',20),instruction:prompt,parentExecutionId,provider:cli as 'codex'|'claude',securityProfileId:profileId,profileMaxDurationMs:profile.maxDurationMs});const parent=store.listExecutions(workspaceId,chatId).find((item)=>item.id===parentExecutionId);if(!parent)throw new Error('Parent execution not found');assertChildAgainstParent(childTask,parent);if(attachmentIds.length)throw new Error('Child tasks cannot receive attachments');prompt=childContext(parent,childTask)}
    const chatAttachmentIds = new Set(store.listChatAttachments(workspaceId, chatId).map((attachment) => attachment.id));
    if (attachmentIds.some((id) => !chatAttachmentIds.has(id))) throw new Error('Attachment not found in chat');
    const attachmentMetadata=new Map(store.listChatAttachments(workspaceId,chatId).map((item)=>[item.id,item])),route=proposeRoute({capabilities:await Promise.all([detectCli('codex'),detectCli('claude')]),preferred:cli as 'codex'|'claude',allowFallback:false,securityProfileId:profileId,attachments:attachmentIds.map((id)=>({id,mediaType:attachmentMetadata.get(id)!.mediaType,bytes:attachmentMetadata.get(id)!.bytes}))});
    assertRoute(route,cli as 'codex'|'claude',profileId);
    const passedToCli: string[] = [],
      unsupported: Array<{ id: string; reason: string }> = [],
      imagePaths: string[] = [],
      textParts: string[] = [];
    for (const attachmentId of attachmentIds) {
      const prepared = store.prepareAttachmentForProvider(
        workspaceId,
        attachmentId,
        cli === 'codex'
          ? {
              inlineText: true,
              filePaths: true,
              acceptedMediaTypes: ['text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'],
              maxBytes: 20 * 1024 * 1024,
            }
          : {
              inlineText: true,
              filePaths: false,
              acceptedMediaTypes: ['text/plain', 'text/markdown'],
              maxBytes: 512 * 1024,
            },
      );
      if (prepared.kind === 'unsupported') unsupported.push({ id: attachmentId, reason: prepared.reason });
      else if (prepared.kind === 'text') {
        textParts.push(prepared.text);
        passedToCli.push(attachmentId);
      } else {
        imagePaths.push(prepared.path);
        passedToCli.push(attachmentId);
      }
    }
    if (textParts.length) {
      const context = textParts.map((content, index) => `\n\n--- Attached text ${index + 1} ---\n${content}`).join('');
      if (prompt.length + context.length > 2_000_000) throw new Error('Prompt and attached text exceed the execution limit');
      prompt += context;
    }
    const budget=createExecutionBudget({kind:parentExecutionId?'child':'root',profile,prompt,attachmentCount:attachmentIds.length});
    if (parentExecutionId) validateOneChildDelegation(store.listExecutions(workspaceId, chatId), parentExecutionId, profileId);
    const runId = store.createExecution({
      workspaceId,
      chatId,
      sourceMessageId,
      cli: cli as 'codex' | 'claude',
      routedCliVersion:route.providers.find((item)=>item.provider===cli)?.version,
      model: value.model ? text(value.model, 'model', 120) : undefined,
      securityProfileId: profileId,
      prompt,
      parentExecutionId,
      depth: parentExecutionId ? 1 : 0,
      taskType:childTask?.type,
      budgetReceipt:serializeExecutionBudget(budget),
    });
    const fallbackEvents: ExecutionEvent[] = [];
    try {
      const running = await startDurableChild({
        workspaceId,
        runId,
        detect: async () => {
          const capability = await detectCli(cli as 'codex' | 'claude');
          if (capability.available && capability.compatible === false) throw new Error(capability.compatibilityError);
          const routedVersion=route.providers.find((item)=>item.provider===cli)?.version;if(capability.version!==routedVersion)throw new Error('CLI version changed after route approval; review the route and retry');
          return capability;
        },
        executionExists: (owner, id) => store.executionIsQueued(owner, id),
        spawn: (capability) =>
          workbench.start(
            runId,
            {
              cli: cli as 'codex' | 'claude',
              prompt,
              workspaceRoot: profile.roots[0],
              profile,
              model: value.model ? text(value.model, 'model', 120) : undefined,
              executable: capability.executable,
              version: capability.version,
              parentRunId: parentExecutionId,
              depth: parentExecutionId ? 1 : 0,
              timeoutMs:budget.maxDurationMs,
              maxOutputBytes:budget.maxOutputBytes,
              imagePaths,
            },
            (event) => {
              fallbackEvents.push(event);
              try {
                store.appendExecutionEvent(runId, workspaceId, event);
              } catch {
                /* The in-memory stream preserves terminal output; deletion revokes persistence authority. */
              }
            },
          ),
        markRunning: (child) => store.startExecution(runId, workspaceId, child.executable, child.version),
      });
      void running.completion
        .then((result) =>
          finalizeExecution(store, {
            runId,
            workspaceId,
            chatId,
            cli: cli as 'codex' | 'claude',
            result,
            fallbackEvents,
          }),
        )
        .catch((error) => console.error('Failed to persist terminal execution state', error));
      return {
        runId,
        status: 'running',
        attachmentDelivery: { passedToCli, unsupported },
      };
    } catch (error) {
      try {
        store.failQueuedExecution(runId, workspaceId, error instanceof Error ? error.message : 'Unknown execution error');
      } catch {
        /* Preserve the original startup error. */
      }
      throw error;
    }
  });
  handle('waypoint:cancel-execution', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, 'workspace ID', 64),
      runId = text(value.runId, 'execution ID', 64);
    if (!store.executionExists(workspaceId, runId)) throw new Error('Execution not found in workspace');
    const targets=[runId,...store.listExecutions(workspaceId).filter((item)=>item.parentExecutionId===runId&&['queued','running'].includes(String(item.status))).map((item)=>String(item.id))];return{canceled:targets.map((id)=>store.cancelQueuedExecution(workspaceId,id)||workbench.cancel(id)).some(Boolean)};
  });
  handle('waypoint:create-chat', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.createChat(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300));
  });
  handle('waypoint:capture-chat', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.captureChat(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000));
  });
  handle('waypoint:add-message', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    const role = text(value.role, 'role', 20);
    if (!['user', 'assistant', 'system'].includes(role)) throw new Error('Invalid role');
    const attachmentIds = Array.isArray(value.attachmentIds) ? value.attachmentIds.map((item) => text(item, 'attachment ID', 64)) : [];
    return store.addMessage(text(value.workspaceId, 'workspace ID', 64), text(value.chatId, 'chat ID', 64), role as 'user' | 'assistant' | 'system', text(value.body, 'body', 2_000_000), attachmentIds);
  });
  handle('waypoint:list-memories', (_event, input: unknown) => store.listMemories(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:scan-memory-suggestions', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return {
      created: store.scanMemorySuggestions(text(value.workspaceId, 'workspace ID', 64), value.chatId ? text(value.chatId, 'chat ID', 64) : undefined),
    };
  });
  handle('waypoint:list-memory-suggestions', (_event, input: unknown) => store.listMemorySuggestions(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:resolve-memory-suggestion', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      action = text(value.action, 'suggestion action', 16);
    if (action !== 'accept' && action !== 'reject') throw new Error('Invalid suggestion action');
    return store.resolveMemorySuggestion(
      text(value.workspaceId, 'workspace ID', 64),
      text(value.suggestionId, 'suggestion ID', 64),
      action,
      value.title !== undefined && value.body !== undefined
        ? {
            title: text(value.title, 'suggestion title', 300),
            body: text(value.body, 'suggestion body', 10_000),
          }
        : undefined,
    );
  });
  handle('waypoint:list-commitments', (_event, input: unknown) => store.listCommitments(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:set-commitment-completed', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.setCommitmentCompleted(text(value.workspaceId, 'workspace ID', 64), text(value.commitmentId, 'commitment ID', 64), value.completed === true);
    return { ok: true };
  });
  handle('waypoint:compose-daily-briefing', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.composeDailyBriefing(text(value.workspaceId, 'workspace ID', 64), text(value.timezone, 'timezone', 100));
  });
  handle('waypoint:dismiss-briefing-item', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      kind = text(value.sourceKind, 'source kind', 20);
    if (!['commitment', 'document', 'memory'].includes(kind)) throw new Error('Invalid briefing source kind');
    store.dismissBriefingItem(text(value.workspaceId, 'workspace ID', 64), text(value.sourceId, 'source ID', 64), kind as 'commitment' | 'document' | 'memory', text(value.localDay, 'local day', 10));
    return { ok: true };
  });
  handle('waypoint:scan-rule-suggestions', (_event, input: unknown) => ({
    created: store.scanRuleSuggestions(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)),
  }));
  handle('waypoint:list-rule-suggestions', (_event, input: unknown) => store.listRuleSuggestions(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:dry-run-rule-suggestion', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.dryRunRuleSuggestion(text(value.workspaceId, 'workspace ID', 64), text(value.suggestionId, 'suggestion ID', 64));
  });
  handle('waypoint:resolve-rule-suggestion', (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      action = text(value.action, 'rule action', 16);
    if (action !== 'approve' && action !== 'reject') throw new Error('Invalid rule action');
    store.resolveRuleSuggestion(text(value.workspaceId, 'workspace ID', 64), text(value.suggestionId, 'suggestion ID', 64), action);
    return { ok: true };
  });
  handle('waypoint:list-learned-rules', (_event, input: unknown) => store.listLearnedRules(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)));
  handle('waypoint:set-learned-rule-enabled', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.setLearnedRuleEnabled(text(value.workspaceId, 'workspace ID', 64), text(value.ruleId, 'rule ID', 64), value.enabled === true);
    return { ok: true };
  });
  handle('waypoint:revert-learned-rule', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.revertLearnedRule(text(value.workspaceId, 'workspace ID', 64), text(value.ruleId, 'rule ID', 64));
    return { ok: true };
  });
  handle('waypoint:create-memory', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.createMemory(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000), value.sourceObjectId ? text(value.sourceObjectId, 'source ID', 64) : undefined);
  });
  handle('waypoint:capture-memory', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.captureMemory(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000), value.sourceObjectId ? text(value.sourceObjectId, 'source ID', 64) : undefined, value.sourceOwned === true ? 'source-owned' : 'workspace-owned');
  });
  handle('waypoint:create-relationship', (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.createRelationship(text(value.workspaceId, 'workspace ID', 64), text(value.fromId, 'source ID', 64), text(value.toId, 'target ID', 64), text(value.type, 'relationship type', 80));
  });
  handle('waypoint:export-workspace', async (_event, input: unknown) => {
    const workspaceId = text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64);
    const warning = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Create plaintext backup', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Backup privacy',
      message: 'Waypoint backups are plaintext.',
      detail: 'Choose a protected location. Deleting content in Waypoint does not delete backup copies.',
    });
    if (warning.response !== 0) return { canceled: true };
    const chosen = await dialog.showSaveDialog({
      title: 'Back up Waypoint workspace',
      defaultPath: 'waypoint-backup.json',
      filters: [{ name: 'Waypoint backup', extensions: ['json'] }],
    });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    const result = writeAtomicBackup(chosen.filePath, store.exportWorkspace(workspaceId));
    return { canceled: false, ...result };
  });
  handle('waypoint:verify-backup', async () => {
    const chosen = await dialog.showOpenDialog({
      title: 'Verify Waypoint backup',
      properties: ['openFile'],
      filters: [{ name: 'Waypoint backup', extensions: ['json'] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
    return {canceled:false,...await runBackupAdministration('verify',chosen.filePaths[0])};
  });
  handle('waypoint:drill-backup',async()=>{
    const chosen=await dialog.showOpenDialog({title:'Test-restore a Waypoint backup',properties:['openFile'],filters:[{name:'Waypoint backup',extensions:['json']}]});
    if(chosen.canceled||!chosen.filePaths[0])return{canceled:true};
    return{canceled:false,...await runBackupAdministration('drill',chosen.filePaths[0])};
  });
  handle('waypoint:restore-workspace', async () => {
    const chosen = await dialog.showOpenDialog({
      title: 'Restore Waypoint backup as a new workspace',
      properties: ['openFile'],
      filters: [{ name: 'Waypoint backup', extensions: ['json'] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
    const archive = readBackup(chosen.filePaths[0]);
    const base = path.basename(chosen.filePaths[0], '.json');
    return {
      canceled: false,
      workspace: store.restoreWorkspace(archive, `${base} restored`, app.getPath('userData')),
    };
  });
  handle('waypoint:diagnostics', async (_event, input: unknown) => {
    return collectDiagnostics(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64));
  });
  handle('waypoint:rebuild-search', (_event, input: unknown) => {
    store.rebuildTextIndex(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64));
    return { ok: true };
  });
  handle('waypoint:export-diagnostics', async (_event, input: unknown) => {
    const workspaceId = text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64),
      payload = exportDiagnosticsReport(await collectDiagnostics(workspaceId));
    const chosen = await dialog.showSaveDialog({
      title: 'Save local diagnostic report',
      defaultPath: 'waypoint-diagnostics.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    const temporary = `${chosen.filePath}.partial-${randomUUID()}`;
    try {
      writeFileSync(temporary, payload, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, chosen.filePath);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    return { canceled: false };
  });
}

function createWindow(): void {
  const statePath = path.join(app.getPath('userData'), 'window-state.json'),
    fallback = { x: 130, y: 70, width: 1180, height: 760 };
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    /* First launch or invalid local state uses a safe visible default. */
  }
  const displays = screen.getAllDisplays().map((display) => ({ id: String(display.id), workArea: display.workArea }));
  const restored = restoreWindowState(saved, displays, fallback);
  const window = new BrowserWindow({
    ...restored.bounds,
    icon: app.isPackaged ? path.join(process.resourcesPath, 'waypoint.png') : path.join(currentDirectory, '../../build/icons/waypoint.png'),
    minWidth: 840,
    minHeight: 620,
    backgroundColor: '#111b19',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    const parsed = new URL(developmentUrl);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('Development server must be an unauthenticated HTTP loopback URL');
  }
  const allowedUrl = developmentUrl ? new URL(developmentUrl).href : pathToFileURL(path.join(currentDirectory, '../../dist/index.html')).href;
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const trusted = contents.id === window.webContents.id && details.requestingUrl === allowedUrl,
      mediaTypes = 'mediaTypes' in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    callback(Boolean(trusted&&permission==='media'&&mediaTypes.length===1&&mediaTypes[0]==='audio'));
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (target !== allowedUrl) event.preventDefault();
  });
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(path.join(currentDirectory, '../../dist/index.html'));
  trustedSenderId = window.webContents.id;
  trustedRendererUrl = allowedUrl;
  if (restored.maximized) window.maximize();
  let timer: NodeJS.Timeout | undefined,
    lastNormalBounds: WindowBounds = restored.bounds,
    resizing = false,
    expanded = restored.maximized;
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const current = window.getBounds(),
        display = screen.getDisplayMatching(current),
        maximized = expanded || window.isMaximized() || window.isFullScreen() || isEffectivelyMaximized(current, display.workArea);
      if (!maximized && !resizing) lastNormalBounds = current;
      const state: SavedWindowState = {
        bounds: maximized ? lastNormalBounds : current,
        displayId: String(display.id),
        maximized,
      };
      const temporary = `${statePath}.partial`;
      try {
        writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
        renameSync(temporary, statePath);
      } catch (error) {
        rmSync(temporary, { force: true });
        console.error('Failed to persist window state', error);
      }
    }, 180);
  };
  window.on('will-resize', () => {
    if (!resizing) {
      const current = window.getBounds(),
        display = screen.getDisplayMatching(current);
      if (!window.isMaximized() && !isEffectivelyMaximized(current, display.workArea)) lastNormalBounds = current;
    }
    resizing = true;
  });
  window.on('resized', () => {
    resizing = false;
    persist();
  });
  window.on('move', persist);
  window.on('resize', persist);
  window.on('maximize', () => {
    expanded = true;
    persist();
  });
  window.on('unmaximize', () => {
    expanded = false;
    persist();
  });
  window.on('enter-full-screen', () => {
    expanded = true;
    persist();
  });
  window.on('leave-full-screen', () => {
    expanded = false;
    persist();
  });
  window.on('close', () => {
    if (timer) clearTimeout(timer);
    const current = window.getBounds(),
      display = screen.getDisplayMatching(current),
      maximized = expanded || window.isMaximized() || window.isFullScreen() || isEffectivelyMaximized(current, display.workArea);
    const state: SavedWindowState = {
      bounds: maximized ? lastNormalBounds : current,
      displayId: String(display.id),
      maximized,
    };
    const temporary = `${statePath}.partial`;
    try {
      writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
      renameSync(temporary, statePath);
    } catch (error) {
      rmSync(temporary, { force: true });
      console.error('Failed to persist window state', error);
    }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(() => {
    store = new WorkspaceStore(path.join(app.getPath('userData'), 'waypoint.sqlite'));
    const voiceRoot=app.isPackaged?path.join(process.resourcesPath,'voice'):path.resolve(currentDirectory,'../../vendor/voice/macos-arm64');
    voiceRuntime=new VoiceRuntimeRegistry(path.join(app.getPath('userData'),'voice-runtime.json'),process.platform,undefined,{
      binaryPath:path.join(voiceRoot,'bin/waypoint-whisper'),modelPath:path.join(voiceRoot,'ggml-base.en-q5_1.bin'),frameworkPath:path.join(voiceRoot,'Frameworks/whisper.framework/Versions/A/whisper'),label:'Whisper base.en q5_1',
      binarySha256:'f74342a44a2addfafcfd30ba74f8bbdeef4044d82f530ae58f49fc20e6d79b4a',modelSha256:'4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f',frameworkSha256:'9664726a3ecf1d9fdadcbc731b9dba3b5bbeea184d42797e044a347c2b7c8ea5'
    },process.arch,process.getSystemVersion());
    voicePacks=new VoicePackManager(path.join(app.getPath('userData'),'voice-packs'));
    const fastAssetsRoot=app.isPackaged?path.join(process.resourcesPath,'fast-local'):path.resolve(currentDirectory,'../../vendor/voice/fast-local-staging'),fastVoiceRoot=path.join(fastAssetsRoot,'kitten'),nativeVoicePackage=`sherpa-onnx-${process.platform==='win32'?'win':'darwin'}-${process.arch}`;fastVoiceSpeech=new FastLocalSpeechProcessAdapter(fastVoiceRoot,path.join(currentDirectory,'core/fast-local-speech-worker.js'));fastVoiceTranscription=new FastLocalTranscriptionProcessAdapter(path.join(fastAssetsRoot,'whisper-tiny.en'),path.join(currentDirectory,'core/fast-local-transcription-worker.js'));fastVoicePackageBytes=directoryBytes(fastAssetsRoot)+directoryBytes(app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked/node_modules',nativeVoicePackage):path.resolve(currentDirectory,'../../node_modules',nativeVoicePackage));
    providerVault=new ProtectedProviderVault(app.getPath('userData'),{available:()=>safeStorage.isEncryptionAvailable(),encrypt:(value)=>safeStorage.encryptString(value),decrypt:(value)=>safeStorage.decryptString(value)});
    toolFailureFingerprintKey=loadToolFailureFingerprintKey();
    const vault = new ProtectedSyncVault(path.join(app.getPath('userData'), 'sync-secrets'), {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(Buffer.from(value)),
    });
    toolGateway=new ToolGateway({domain:async(workspaceId,command,input,origin)=>{if(command==='workspace.summary')return{value:{workspace:store.listWorkspaces().find((item)=>item.id===workspaceId),chats:store.listChats(workspaceId).length,documents:store.listDocuments(workspaceId).length,memories:store.listMemories(workspaceId).length},summary:'Read workspace summary'};if(command==='chat.create'){const id=store.createChat(workspaceId,text(input.title,'chat title',300));return{value:{chatId:id},summary:'Created chat',rollbackRef:`delete:chat:${id}`}}if(command==='memory.create'){const id=store.createMemory(workspaceId,text(input.title,'memory title',300),text(input.body,'memory body',10_000));return{value:{memoryId:id},summary:'Created memory',rollbackRef:`delete:memory:${id}`}}if(command==='provider.preferences.update'){const current=store.openRouterSettings(),next=store.setOpenRouterSettings({...current,strategicModel:input.strategicModel===undefined?current.strategicModel:text(input.strategicModel,'strategic model ID',200),everydayModel:input.everydayModel===undefined?current.everydayModel:text(input.everydayModel,'everyday model ID',200),fallbackProvider:['codex','claude'].includes(String(input.fallbackProvider))?input.fallbackProvider as 'codex'|'claude':current.fallbackProvider,monthlyCapMicros:input.monthlyCapMicros===undefined?current.monthlyCapMicros:Number(input.monthlyCapMicros),ytdCapMicros:input.ytdCapMicros===undefined?current.ytdCapMicros:Number(input.ytdCapMicros),warningPercent:input.warningPercent===undefined?current.warningPercent:Number(input.warningPercent)});return{value:{...next,enabled:undefined,liveRequestsEnabled:undefined},summary:'Updated non-security provider preferences'}}throw new Error(origin==='ai'?'tool_domain_command_unavailable':'Unknown domain command')},progress:(event)=>{for(const window of BrowserWindow.getAllWindows())if(toolWindowWorkspaces.get(window.webContents.id)===event.workspaceId)window.webContents.send('waypoint:tool-gateway-progress',event)},complete:(result)=>{store.saveToolReceipt(result.receipt)},preflight:(request)=>{const material=toolFailureKeyFor(request.workspaceId,vault);return store.findToolFailure(request.workspaceId,failureIdentity(material.key,request,material.capabilityVersion,localFailureContext()))},learn:(request,result,overrideReason,remediation)=>{const material=toolFailureKeyFor(request.workspaceId,vault);store.recordToolOutcome(request,failureIdentity(material.key,request,material.capabilityVersion,localFailureContext()),result,safeFailureNote(overrideReason),safeFailureNote(remediation))}})
    void DesktopSyncService.create(vault)
      .then((service) => {
        syncService = service;
        registerIpc();
        createWindow();
        const timer = setInterval(() => {
          for (const workspace of store.listWorkspaces()) {
            if (activeSyncRuns.has(workspace.id) || !syncService.status(workspace.id).configured) continue;
            activeSyncRuns.add(workspace.id);
            void syncService
              .syncOnce(workspace.id, store, syncAbort.signal)
              .then(()=>processRemoteJobs(workspace.id))
              .catch((error) => {
                if (!syncAbort.signal.aborted) console.warn('Workspace sync attempt failed', error instanceof Error ? error.message : 'unknown');
              })
              .finally(() => activeSyncRuns.delete(workspace.id));
          }
        }, 5_000);
        timer.unref();
      })
      .catch((error) => {
        console.error('Protected sync startup failed', error);
        dialog.showErrorBox('Waypoint protected storage unavailable', 'Sync requires macOS Keychain or Windows DPAPI. Waypoint cannot start sync safely on this device.');
        app.quit();
      });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  let shutdownStarted = false;
  app.on('before-quit', (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    syncAbort.abort();
    for(const workspace of store?.listWorkspaces()??[])toolGateway?.stop(workspace.id)
    void workbench.shutdown().finally(() => {
      store?.close();
      app.exit(0);
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
