import { FormEvent, Fragment, StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ActivityFamily, ActivityTimelineItem, AttachmentMetadata, FixturePlaybookView, SanitizedSyncStatus, WorkspaceSummary } from '../electron/core/types';
import type { DiagnosticsReport } from '../electron/core/diagnostics';
import { failureAdvice, type ExecutionRunView } from './ai-workbench-ui';
import { reconcileSelectedChatId, RefreshGate } from './chat-selection';
import { groupChatHistory, type HistorySort } from './chat-history';
import waypointMark from './assets/waypoint-mark.svg';
import './styles.css';
import './provider-settings.css';
import './chat-header-actions.css';
import'./voice-mode.css';
import{BrowserPcmCapture,BrowserSpeechMonitor,BrowserVoicePlayer}from'./voice-capture';
import{cancelLateVoiceRun}from'./voice-run-cancellation';
import{openRouterModelChoices}from'./openrouter-model-catalog';
import{responseNoticeAfterRuns,runsForSourceMessage,uniqueChatRuns,uniqueExecutionEvents}from'./chat-run-presentation';
import{withLegacyModel}from'./provider-model-choices';
import{nextOpenRouterActivation}from'./openrouter-activation';
import{shouldFollowChat}from'./chat-scroll';
import{ChatMarkdown}from'./chat-markdown';
import{meetingWavSegments}from'./meeting-transcription.js';
type VoiceMode='push_to_talk'|'hands_free';type VoiceState='off'|'listening'|'transcribing'|'thinking'|'speaking'|'error';

type Chat = Awaited<ReturnType<Window['waypoint']['listChats']>>[number];
type Document = Awaited<ReturnType<Window['waypoint']['listDocuments']>>[number];
type Memory = Awaited<ReturnType<Window['waypoint']['listMemories']>>[number];
type MemorySuggestion = Awaited<ReturnType<Window['waypoint']['listMemorySuggestions']>>[number];
type Commitment = Awaited<ReturnType<Window['waypoint']['listCommitments']>>[number];
type Briefing = Awaited<ReturnType<Window['waypoint']['composeDailyBriefing']>>;
type RuleSuggestion = Awaited<ReturnType<Window['waypoint']['listRuleSuggestions']>>[number];
type LearnedRule = Awaited<ReturnType<Window['waypoint']['listLearnedRules']>>[number];
type KnowledgeGraph = Awaited<ReturnType<Window['waypoint']['graph']>>;
type Meeting = Awaited<ReturnType<Window['waypoint']['listMeetings']>>[number];
type TranscriptionCapability = Awaited<ReturnType<Window['waypoint']['meetingTranscriptionCapability']>>;
type TriggerLab=Awaited<ReturnType<Window['waypoint']['listLocalTriggerLab']>>;
type WebhookChannels=Awaited<ReturnType<Window['waypoint']['webhookChannels']>>;
type WebhookEvent=Awaited<ReturnType<Window['waypoint']['listWebhookEvents']>>[number];
type ToolSettings=Awaited<ReturnType<Window['waypoint']['toolGatewaySettings']>>;type ToolReceipt=Awaited<ReturnType<Window['waypoint']['toolGatewayReceipts']>>[number];type ToolCapabilities=Awaited<ReturnType<Window['waypoint']['toolGatewayCapabilities']>>;
type ToolFailure=Awaited<ReturnType<Window['waypoint']['toolFailures']>>[number];
type RollupSettings=Awaited<ReturnType<Window['waypoint']['crossWorkspaceRollupSettings']>>;
type OpenRouterStatus=Awaited<ReturnType<Window['waypoint']['openRouterStatus']>>;
type CliModelCatalog=Awaited<ReturnType<Window['waypoint']['cliModelCatalog']>>;
type VoiceCapability=Awaited<ReturnType<Window['waypoint']['voiceCapability']>>;
type VoiceEngineStatus=Awaited<ReturnType<Window['waypoint']['voiceEngineStatus']>>;
type ActivityCaptureStatus=Awaited<ReturnType<Window['waypoint']['activityCaptureStatus']>>;type ActivitySnapshot=Awaited<ReturnType<Window['waypoint']['listActivitySnapshots']>>[number];
type Drawer = 'briefing' | 'knowledge' | 'reflection' | 'rules' | 'meetings' | 'automations' | 'activity' | 'health' | 'settings' | undefined;

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSummary>(),
    [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [chats, setChats] = useState<Chat[]>([]),
    [selectedChatId, setSelectedChatId] = useState<string>(),
    [documents, setDocuments] = useState<Document[]>([]),
    [memories, setMemories] = useState<Memory[]>([]),
    [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]),
    [commitments, setCommitments] = useState<Commitment[]>([]),
    [activity, setActivity] = useState<ActivityTimelineItem[]>([]);
  const [profiles, setProfiles] = useState<Awaited<ReturnType<Window['waypoint']['listSecurityProfiles']>>>([]),
    [runs, setRuns] = useState<Array<Record<string, unknown>>>([]),
    [capabilities, setCapabilities] = useState<Awaited<ReturnType<Window['waypoint']['cliCapabilities']>>>([]),[cliModels,setCliModels]=useState<CliModelCatalog>([]),[chatModels,setChatModels]=useState<Record<'codex'|'claude',string>>({codex:'',claude:''});
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]),
    [attachmentBusy, setAttachmentBusy] = useState(false),
    [chatCli, setChatCli] = useState<'codex' | 'claude'|'openrouter'>('codex'),
    [routeProposal,setRouteProposal]=useState<Awaited<ReturnType<Window['waypoint']['proposeChatRoute']>>>(),
    [selectedProfileId,setSelectedProfileId]=useState('');
  const [documentIndexes,setDocumentIndexes]=useState<Record<string,Awaited<ReturnType<Window['waypoint']['documentIndexStatus']>>>>({}),[documentImportBusy,setDocumentImportBusy]=useState(false);
  const [drawer, setDrawer] = useState<Drawer>(),
    [sidebarOpen, setSidebarOpen] = useState(false),
    [historyQuery, setHistoryQuery] = useState(''),
    [historySort, setHistorySort] = useState<HistorySort>('recent'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [diagnostics, setDiagnostics] = useState<DiagnosticsReport>(),
    [checking, setChecking] = useState(false),
    [syncStatus, setSyncStatus] = useState<SanitizedSyncStatus>();
  const [desktopSync, setDesktopSync] = useState<Awaited<ReturnType<Window['waypoint']['desktopSyncStatus']>>>(),
    [syncDevices, setSyncDevices] = useState<Awaited<ReturnType<Window['waypoint']['syncDevices']>>>([]),
    [pendingPeers, setPendingPeers] = useState<Awaited<ReturnType<Window['waypoint']['pendingSyncEnrollments']>>>([]),
    [bootstrapBundle, setBootstrapBundle] = useState('');
  const [deviceControl,setDeviceControl]=useState<Awaited<ReturnType<Window['waypoint']['deviceControlStatus']>>>();
  const [briefing, setBriefing] = useState<Briefing>();
  const [ruleSuggestions, setRuleSuggestions] = useState<RuleSuggestion[]>([]),
    [learnedRules, setLearnedRules] = useState<LearnedRule[]>([]),
    [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph>({
      nodes: [],
      edges: [],
    });
  const [activityQuery, setActivityQuery] = useState(''),
    [activityFamilyFilter, setActivityFamilyFilter] = useState<ActivityFamily | 'all'>('all'),
    [activityKnowledgeTarget, setActivityKnowledgeTarget] = useState<string>();
  const[activityCapture,setActivityCapture]=useState<ActivityCaptureStatus>(),[activitySnapshots,setActivitySnapshots]=useState<ActivitySnapshot[]>([]),[activitySnapshotQuery,setActivitySnapshotQuery]=useState(''),[activityExclusions,setActivityExclusions]=useState(''),[activityPreview,setActivityPreview]=useState<{id:string;url:string}>();
  const[reflectionRuns,setReflectionRuns]=useState<Awaited<ReturnType<Window['waypoint']['reflectionRuns']>>>([]),[selectedReflectionRunId,setSelectedReflectionRunId]=useState<string>(),[reflectionProposals,setReflectionProposals]=useState<Awaited<ReturnType<Window['waypoint']['reflectionProposals']>>>([]),[reflectionSources,setReflectionSources]=useState<string[]>([]),[reflectionProvider,setReflectionProvider]=useState<'codex'|'claude'>('codex'),[reflectionActive,setReflectionActive]=useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]),
    [meetingConsent, setMeetingConsent] = useState(false),
    [recordingMeetingId, setRecordingMeetingId] = useState<string>(),
    [recordingSeconds, setRecordingSeconds] = useState(0),
    [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({}),
    [transcriptionCapability, setTranscriptionCapability] = useState<TranscriptionCapability>(),[meetingTranscriptionRun,setMeetingTranscriptionRun]=useState<{runId:string;meetingId:string;completed:number}>();
  const [playbooks, setPlaybooks] = useState<FixturePlaybookView[]>([]),
    [dryRunDigests, setDryRunDigests] = useState<Record<string, string>>({}),[triggerLab,setTriggerLab]=useState<TriggerLab>(),[webhookChannels,setWebhookChannels]=useState<WebhookChannels>(),[webhookEvents,setWebhookEvents]=useState<WebhookEvent[]>([]);
  const[toolSettings,setToolSettings]=useState<ToolSettings>(),[toolReceipts,setToolReceipts]=useState<ToolReceipt[]>([]),[toolFailures,setToolFailures]=useState<ToolFailure[]>([]),[toolCapabilities,setToolCapabilities]=useState<ToolCapabilities>(),[denyDraft,setDenyDraft]=useState(''),[webSearchKey,setWebSearchKeyDraft]=useState('');
  const[rollupSettings,setRollupSettings]=useState<RollupSettings>(),[rollupPreview,setRollupPreview]=useState<Awaited<ReturnType<Window['waypoint']['composeCrossWorkspaceRollup']>>>();
  const[openRouter,setOpenRouter]=useState<OpenRouterStatus>(),[openRouterKey,setOpenRouterKeyDraft]=useState('');
  const[voiceCapability,setVoiceCapability]=useState<VoiceCapability>(),[voiceEngineStatus,setVoiceEngineStatus]=useState<VoiceEngineStatus>(),[voiceEngine,setVoiceEngine]=useState<'fast_local'|'full_duplex_experimental'>('fast_local'),[voiceSessionActive,setVoiceSessionActive]=useState(false),[voiceState,setVoiceState]=useState<VoiceState>('off'),[voiceMode,setVoiceMode]=useState<VoiceMode>('push_to_talk'),[voiceDevice,setVoiceDevice]=useState(''),[voiceDevices,setVoiceDevices]=useState<MediaDeviceInfo[]>([]),[voicePartial,setVoicePartial]=useState('');
  const refreshGate = useRef(new RefreshGate()),routeGate=useRef(new RefreshGate()),
    composerRef = useRef<HTMLTextAreaElement>(null),
    transcriptRef = useRef<HTMLElement>(null),
    transcriptFollowingRef = useRef(true),
    overlayRef = useRef<HTMLElement>(null),
    previousFocusRef = useRef<HTMLElement | null>(null),activeWorkspaceRef=useRef<string|undefined>(undefined);activeWorkspaceRef.current=workspace?.id;
  const voiceCaptureRef=useRef(new BrowserPcmCapture()),voiceMonitorRef=useRef(new BrowserSpeechMonitor()),voicePlayerRef=useRef(new BrowserVoicePlayer(undefined,(scope)=>void window.waypoint.voicePlaybackComplete(scope.workspaceId,scope.chatId,scope.turnId),(scope)=>void window.waypoint.voicePlaybackStopped(scope.workspaceId,scope.chatId,scope.turnId))),voiceTurnRef=useRef(0),voiceSubmissionRef=useRef<number|undefined>(undefined),voiceRunRef=useRef<{turn:number;workspaceId?:string;chatId:string;sourceMessageId?:string;runId?:string;spoken?:boolean}|undefined>(undefined),voiceStateRef=useRef<VoiceState>('off'),voicePressReleasedRef=useRef(false),voiceCaptureTargetRef=useRef<{workspaceId:string;chatId:string}|undefined>(undefined),voiceScopeRef=useRef<{workspaceId?:string;chatId?:string}>({});
  const meetingTranscriptionGenerationRef=useRef(0),meetingRecorderRef = useRef<MediaRecorder | undefined>(undefined),
    meetingStreamRef = useRef<MediaStream | undefined>(undefined),
    meetingChunksRef = useRef<Blob[]>([]),
    meetingTimerRef = useRef<number | undefined>(undefined),
    meetingIdRef = useRef<string | undefined>(undefined),
    meetingWorkspaceIdRef = useRef<string | undefined>(undefined),
    meetingStoppingRef = useRef(false),
    meetingBytesRef = useRef(0);

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason));
  }
  async function selectReflectionRun(runId:string){if(!workspace)return;setSelectedReflectionRunId(runId);setReflectionProposals(await window.waypoint.reflectionProposals(workspace.id,runId))}
  async function openReflection(){if(!workspace)return;setSidebarOpen(false);setDrawer('reflection');const runs=await window.waypoint.reflectionRuns(workspace.id);setReflectionRuns(runs);setReflectionSources([...memories.map((item)=>item.id),...documents.map((item)=>item.id)].slice(0,50));const selected=runs[0];setSelectedReflectionRunId(selected?.id);setReflectionProposals(selected?await window.waypoint.reflectionProposals(workspace.id,selected.id):[])}
  async function startReflection(){if(!workspace)return;setReflectionActive(true);setNotice(`${reflectionProvider} is reviewing the selected local sources…`);try{const result=await window.waypoint.startReflection(workspace.id,reflectionSources,reflectionProvider),runs=await window.waypoint.reflectionRuns(workspace.id);setReflectionRuns(runs);setSelectedReflectionRunId(result.runId);setReflectionProposals(await window.waypoint.reflectionProposals(workspace.id,result.runId));setNotice(`${result.proposalCount} reviewable reflection proposal${result.proposalCount===1?'':'s'} created by the signed-in ${reflectionProvider} CLI. Sources were not overwritten.`)}finally{setReflectionActive(false);setReflectionRuns(await window.waypoint.reflectionRuns(workspace.id))}}
  async function resolveReflection(item:(typeof reflectionProposals)[number],action:'accept'|'edit'|'reject'|'rollback'){if(!workspace)return;let body:string|undefined;if(action==='edit'){body=window.prompt('Edit the proposed revision before accepting',item.proposedBody)??undefined;if(body===undefined)return}await window.waypoint.resolveReflection(workspace.id,item.id,action,body);if(selectedReflectionRunId)await selectReflectionRun(selectedReflectionRunId);setReflectionRuns(await window.waypoint.reflectionRuns(workspace.id));await refresh();setNotice(`Reflection proposal ${action==='edit'?'edited and accepted':action}.`)}
  async function loadToolGateway(){if(!workspace)return;const[settings,receipts,failures,caps]=await Promise.all([window.waypoint.toolGatewaySettings(workspace.id),window.waypoint.toolGatewayReceipts(workspace.id),window.waypoint.toolFailures(workspace.id),window.waypoint.toolGatewayCapabilities()]);setToolSettings(settings);setDenyDraft(settings.denyPatterns.join('\n'));setToolReceipts(receipts);setToolFailures(failures);setToolCapabilities(caps)}
  async function updateWebTools(value:{webFetchEnabled:boolean;webSearchEnabled:boolean}){if(!workspace)return;await window.waypoint.updateWebTools(workspace.id,value);await loadToolGateway();setNotice('Web tool policy saved for this workspace.')}
  async function saveToolGateway(overrides:Partial<ToolSettings>={}){if(!workspace||!toolSettings)return;const next={stopped:overrides.stopped??toolSettings.stopped,denyPatterns:overrides.denyPatterns??denyDraft.split('\n').map((item)=>item.trim()).filter(Boolean),suppressCommit:overrides.suppressCommit??toolSettings.suppressCommit,suppressPush:overrides.suppressPush??toolSettings.suppressPush,browserProfileMode:overrides.browserProfileMode??toolSettings.browserProfileMode,browserProfileName:overrides.browserProfileName??toolSettings.browserProfileName,browserAllowedDomains:overrides.browserAllowedDomains??toolSettings.browserAllowedDomains};setToolSettings(await window.waypoint.updateToolGatewaySettings(workspace.id,next));if(next.stopped)await stopVoiceMode();await loadToolGateway();setNotice(next.stopped?'Tool Gateway and active voice stopped for this workspace.':'Tool Gateway policy saved.')}
  async function saveRollups(next:RollupSettings){if(!workspace)return;setRollupSettings(await window.waypoint.updateCrossWorkspaceRollupSettings(workspace.id,{standingEnabled:next.standingEnabled,grants:next.grants.map(({sourceWorkspaceId,family,enabled})=>({sourceWorkspaceId,family,enabled}))}));setNotice('Cross-workspace summary grants saved. Raw source bodies remain isolated.')}
  async function refreshOpenRouter(){setOpenRouter(await window.waypoint.openRouterStatus())}
  async function storeOpenRouterKey(){if(!openRouterKey)return;await window.waypoint.setOpenRouterKey(openRouterKey);setOpenRouterKeyDraft('');await refreshOpenRouter();setNotice('OpenRouter key stored in OS-protected storage. Enable hosted requests with the single activation control when ready.')}
  async function saveOpenRouterSettings(){if(!openRouter)return;await window.waypoint.updateOpenRouterSettings(openRouter.settings);await refreshOpenRouter();setNotice('OpenRouter preferences saved. Hosted requests occur only when the provider and explicit hosted-request switch are enabled.')}
  async function toggleOpenRouterActivation(){if(!openRouter)return;const active=openRouter.settings.enabled&&openRouter.settings.liveRequestsEnabled,next=nextOpenRouterActivation(openRouter.settings,openRouter.keyConfigured);await window.waypoint.updateOpenRouterSettings(next);await refreshOpenRouter();setNotice(active?'OpenRouter hosted requests disabled.':'OpenRouter hosted requests enabled with protected key, selected models, and existing spending caps. No test request was sent.')}
  async function changeComposerModel(value:string){if(chatCli==='openrouter'){if(!openRouter)return;const next={...openRouter.settings,everydayModel:value};setOpenRouter({...openRouter,settings:next});await window.waypoint.updateOpenRouterSettings(next);await refreshOpenRouter();return}if(!workspace)return;setChatModels(await window.waypoint.setChatModelPreference(workspace.id,chatCli,value))}
  async function openAutomations() {
    if (!workspace) return;
    const[nextPlaybooks,nextLab,nextSync]=await Promise.all([window.waypoint.listFixturePlaybooks(workspace.id),window.waypoint.listLocalTriggerLab(workspace.id),window.waypoint.desktopSyncStatus(workspace.id)]);setPlaybooks(nextPlaybooks);setTriggerLab(nextLab);if(nextSync.configured&&nextSync.transportMode==='hosted-relay'){const[channels,events]=await Promise.all([window.waypoint.webhookChannels(workspace.id),window.waypoint.listWebhookEvents(workspace.id)]);setWebhookChannels(channels);setWebhookEvents(events)}else{setWebhookChannels(undefined);setWebhookEvents([]);if(nextSync.configured)setNotice('Public inbound webhooks require the optional hosted relay. Direct desktop hosting remains available for peer sync and agent control.')}
    setSidebarOpen(false);
    setDrawer('automations');
  }
  async function createTriggerFixture(){if(!workspace)return;const eventType=window.prompt('Local fixture event type','document.imported')?.trim();if(!eventType)return;const title=window.prompt('Synthetic fixture title','Local webhook simulation')?.trim();if(!title)return;await window.waypoint.createLocalWebhookFixture(workspace.id,eventType,crypto.randomUUID(),{title,fixture:true});setTriggerLab(await window.waypoint.listLocalTriggerLab(workspace.id));setNotice('Synthetic webhook event quarantined locally. A suggested rule is waiting for review; no listener or action was enabled.')}
  async function approveTriggerRule(ruleId:string){if(!workspace)return;await window.waypoint.approveLocalTriggerRule(workspace.id,ruleId);setTriggerLab(await window.waypoint.listLocalTriggerLab(workspace.id));setNotice('Rule approved into paused, simulation-only state. It cannot run unattended.')}
  async function dryRunTrigger(ruleId:string,simulateFailure=false){if(!workspace)return;const result=await window.waypoint.dryRunLocalTriggerRule(workspace.id,ruleId,simulateFailure);setTriggerLab(await window.waypoint.listLocalTriggerLab(workspace.id));setNotice(result.idempotent?'This exact zero-effect dry run was already recorded.':`${result.status.replace('_',' ')} recorded at attempt ${result.attempt}, with zero proposed effects.`)}
  async function toggleTriggerKill(){if(!workspace||!triggerLab)return;await window.waypoint.setLocalTriggerKill(workspace.id,!triggerLab.killSwitch);setTriggerLab(await window.waypoint.listLocalTriggerLab(workspace.id));setNotice(triggerLab.killSwitch?'Local trigger evaluation resumed; rules remain paused and simulation-only.':'Workspace trigger kill switch enabled. All evaluations are blocked.')}
  async function deleteTriggerEvent(eventId:string){if(!workspace||!window.confirm('Permanently delete this local fixture event, its suggested rule, and all dry-run history?'))return;await window.waypoint.deleteLocalTriggerEvent(workspace.id,eventId);setTriggerLab(await window.waypoint.listLocalTriggerLab(workspace.id))}
  async function createWebhookChannel(){if(!workspace)return;const label=window.prompt('Inbound webhook channel name','Private inbound')?.trim();if(!label)return;const result=await window.waypoint.createWebhookChannel(workspace.id,label),configuration={endpoint:`https://waypoint-relay.johnnycode.ai/v1/hooks/${result.channelId}`,channelId:result.channelId,secretVersion:result.secretVersion,signingSecret:result.secret,recipientPublicKey:result.recipientPublicKey,mime:'application/vnd.waypoint.encrypted-event+json'};await navigator.clipboard.writeText(JSON.stringify(configuration,null,2));setWebhookChannels(await window.waypoint.webhookChannels(workspace.id));setNotice('One-time encrypted sender configuration copied to the clipboard. Store it in the sender’s protected secret storage; Waypoint will not show the signing secret again.')}
  async function rotateWebhookChannel(channelId:string){if(!workspace||!window.confirm('Rotate this signing secret now? The previous sender configuration will stop immediately.'))return;const result=await window.waypoint.rotateWebhookChannel(workspace.id,channelId);await navigator.clipboard.writeText(JSON.stringify({channelId,secretVersion:result.secretVersion,signingSecret:result.secret},null,2));setWebhookChannels(await window.waypoint.webhookChannels(workspace.id));setNotice('Rotated one-time signing configuration copied. Update the sender before retrying.')}
  async function refreshWebhookEvents(){if(!workspace)return;const result=await window.waypoint.fetchWebhookEvents(workspace.id);setWebhookEvents(await window.waypoint.listWebhookEvents(workspace.id));setNotice(`${result.imported} signed inbound event${result.imported===1?'':'s'} fetched into quarantine. No rule, model, or action ran.`)}
  async function deleteWebhookEvent(eventId:string){if(!workspace||!window.confirm('Permanently delete this quarantined inbound event?'))return;await window.waypoint.deleteWebhookEvent(workspace.id,eventId);setWebhookEvents(await window.waypoint.listWebhookEvents(workspace.id))}
  async function createPlaybook() {
    if (!workspace) return;
    const title = window.prompt('Fixture playbook title', 'Morning fixture review')?.trim();
    if (!title) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    await window.waypoint.createFixturePlaybook(workspace.id, title, timezone, 9, 0);
    setPlaybooks(await window.waypoint.listFixturePlaybooks(workspace.id));
    setNotice('Paused fixture playbook created. No schedule or external account was enabled.');
  }
  async function dryRunPlaybook(id: string) {
    if (!workspace) return;
    const result = await window.waypoint.dryRunFixturePlaybook(workspace.id, id);
    setDryRunDigests((current) => ({ ...current, [id]: result.digest }));
    setPlaybooks(await window.waypoint.listFixturePlaybooks(workspace.id));
    setNotice(`Dry run reviewed ${result.inputCount} synthetic items, deduplicated to ${result.deduplicatedCount}, with zero proposed effects.`);
  }
  async function runPlaybook(id: string, simulateFailure = false) {
    if (!workspace || !dryRunDigests[id]) return;
    const result = await window.waypoint.runFixturePlaybook(workspace.id, id, dryRunDigests[id], simulateFailure);
    setPlaybooks(await window.waypoint.listFixturePlaybooks(workspace.id));
    setNotice(result.idempotent ? 'This exact fixture run was already completed.' : simulateFailure ? `Synthetic failure recorded as ${result.status.replace('_', ' ')}; retry remains manual and bounded.` : 'Fixture run completed locally with no external effects.');
  }
  async function killPlaybook(id: string) {
    if (!workspace) return;
    await window.waypoint.killFixturePlaybook(workspace.id, id);
    setDryRunDigests((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPlaybooks(await window.waypoint.listFixturePlaybooks(workspace.id));
  }
  async function deletePlaybook(id: string) {
    if (!workspace || !window.confirm('Permanently delete this fixture playbook and its local run history?')) return;
    await window.waypoint.deleteFixturePlaybook(workspace.id, id);
    setPlaybooks(await window.waypoint.listFixturePlaybooks(workspace.id));
  }
  async function openMeetings() {
    if (!workspace) return;
    const [nextMeetings, capability] = await Promise.all([window.waypoint.listMeetings(workspace.id), window.waypoint.meetingTranscriptionCapability()]);
    setMeetings(nextMeetings);
    setTranscriptDrafts(Object.fromEntries(nextMeetings.map((item) => [item.id, item.transcript ?? ''])));
    setTranscriptionCapability(capability);
    setSidebarOpen(false);
    setDrawer('meetings');
  }
  async function startMeeting() {
    if (!workspace || !meetingConsent) throw new Error('Acknowledge recording consent for this session first');
    const title = window.prompt('Meeting title', 'Meeting notes')?.trim();
    if (!title) {
      setMeetingConsent(false);
      return;
    }
    let stream: MediaStream | undefined, meetingId: string | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      meetingId = (await window.waypoint.createMeeting(workspace.id, title, true)).meetingId;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
        recorder = new MediaRecorder(stream, { mimeType }),
        track = stream.getAudioTracks()[0];
      if (!track) throw new Error('No microphone audio track was available');
      meetingChunksRef.current = [];
      meetingBytesRef.current = 0;
      meetingStoppingRef.current = false;
      meetingIdRef.current = meetingId;
      meetingWorkspaceIdRef.current=workspace.id;
      meetingStreamRef.current = stream;
      meetingRecorderRef.current = recorder;
      setRecordingMeetingId(meetingId);
      setRecordingSeconds(0);
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        meetingChunksRef.current.push(event.data);
        meetingBytesRef.current += event.data.size;
        if (meetingBytesRef.current > 100 * 1024 * 1024) void stopMeeting('size_limit');
      };
      recorder.onerror=()=>void stopMeeting('capture_failed');
      track.onended = () => void stopMeeting('device_lost');
      recorder.start(1000);
      meetingTimerRef.current = window.setInterval(
        () =>
          setRecordingSeconds((value) => {
            if (value >= 7199) void stopMeeting();
            return value + 1;
          }),
        1000,
      );
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      if (meetingId) await window.waypoint.failMeeting(workspace.id, meetingId, 'capture_failed').catch(() => undefined);
      meetingRecorderRef.current = undefined;
      meetingStreamRef.current = undefined;
      meetingIdRef.current = undefined;
      meetingWorkspaceIdRef.current = undefined;
      meetingChunksRef.current = [];
      setRecordingMeetingId(undefined);
      setRecordingSeconds(0);
      setMeetingConsent(false);
      throw reason;
    }
  }
  async function stopMeeting(failureCode?: 'device_lost' | 'interrupted' | 'capture_failed' | 'size_limit') {
    const recorder = meetingRecorderRef.current,
      meetingId = meetingIdRef.current,
      originWorkspaceId = meetingWorkspaceIdRef.current;
    if (!recorder || !meetingId || !originWorkspaceId || meetingStoppingRef.current) return;
    meetingStoppingRef.current = true;
    if (meetingTimerRef.current) window.clearInterval(meetingTimerRef.current);
    if (recorder.state !== 'inactive')
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    meetingStreamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    try {
      if (failureCode) await window.waypoint.failMeeting(originWorkspaceId, meetingId, failureCode);
      else {
        const blob = new Blob(meetingChunksRef.current, {
            type: recorder.mimeType,
          }),
          audio = new Uint8Array(await blob.arrayBuffer());
        await window.waypoint.finalizeMeeting(originWorkspaceId,meetingId,recorder.mimeType.split(';')[0],audio);
      }
    } finally {
      meetingRecorderRef.current = undefined;
      meetingStreamRef.current = undefined;
      meetingIdRef.current = undefined;
      meetingWorkspaceIdRef.current = undefined;
      meetingChunksRef.current = [];
      meetingBytesRef.current = 0;
      meetingStoppingRef.current = false;
      setRecordingMeetingId(undefined);
      setRecordingSeconds(0);
      setMeetingConsent(false);
      if (workspace?.id === originWorkspaceId) setMeetings(await window.waypoint.listMeetings(originWorkspaceId));
    }
  }
  async function playMeeting(meetingId: string) {
    if (!workspace) return;
    const result = await window.waypoint.readMeetingAudio(workspace.id, meetingId),
      url = URL.createObjectURL(
        new Blob([Uint8Array.from(result.audio).buffer], {
          type: result.mediaType,
        }),
      ),
      audio = new Audio(url),
      release = () => URL.revokeObjectURL(url);
    audio.addEventListener('ended', release, { once: true });
    audio.addEventListener('error', release, { once: true });
    await audio.play();
  }
  async function saveTranscript(meetingId: string, reviewed: boolean) {
    if (!workspace) return;
    await window.waypoint.updateMeetingTranscript(workspace.id, meetingId, transcriptDrafts[meetingId] ?? '', reviewed);
    setMeetings(await window.waypoint.listMeetings(workspace.id));
    setNotice(reviewed ? 'Transcript marked reviewed.' : 'Transcript draft saved locally.');
  }
  async function transcribeMeeting(meetingId:string){if(!workspace||meetingTranscriptionRun)return;const generation=++meetingTranscriptionGenerationRef.current,origin=workspace.id,{audio}=await window.waypoint.readMeetingAudio(origin,meetingId),context=new AudioContext();let runId:string|undefined,decoded:AudioBuffer|undefined;try{if(audio.byteLength>25*1024*1024)throw new Error('Automatic local transcription currently supports recordings up to 25 MiB and ten minutes; manual transcript review remains available.');decoded=await context.decodeAudioData(audio.buffer.slice(audio.byteOffset,audio.byteOffset+audio.byteLength));const started=await window.waypoint.startMeetingTranscription(origin,meetingId);runId=started.runId;setMeetingTranscriptionRun({runId,meetingId,completed:0});let index=0;for(const wav of meetingWavSegments(decoded)){try{await window.waypoint.transcribeMeetingSegment(origin,meetingId,runId,index,wav)}finally{wav.fill(0)}index++;if(meetingTranscriptionGenerationRef.current===generation)setMeetingTranscriptionRun({runId,meetingId,completed:index})}const result=await window.waypoint.finishMeetingTranscription(origin,meetingId,runId);if(activeWorkspaceRef.current===origin&&meetingTranscriptionGenerationRef.current===generation){setTranscriptDrafts((current)=>({...current,[meetingId]:result.transcript}));setMeetings(await window.waypoint.listMeetings(origin));setNotice(`Local draft created with ${result.provider}. Review speakers and text before saving to knowledge.`)}}catch(reason){if(runId)await window.waypoint.cancelMeetingTranscription(origin,meetingId,runId).catch(()=>undefined);if(activeWorkspaceRef.current===origin&&meetingTranscriptionGenerationRef.current===generation)showError(reason)}finally{if(decoded)for(let channel=0;channel<decoded.numberOfChannels;channel++)decoded.getChannelData(channel).fill(0);await context.close().catch(()=>undefined);if(meetingTranscriptionGenerationRef.current===generation)setMeetingTranscriptionRun(undefined);audio.fill(0)}}
  async function cancelMeetingTranscription(){if(!workspace||!meetingTranscriptionRun)return;await window.waypoint.cancelMeetingTranscription(workspace.id,meetingTranscriptionRun.meetingId,meetingTranscriptionRun.runId);setNotice('Canceling local meeting transcription; the previous transcript remains unchanged.')}
  async function saveMeetingMemory(meetingId: string) {
    if (!workspace) return;
    await window.waypoint.saveMeetingMemory(workspace.id, meetingId);
    await refresh();
    setNotice('Reviewed transcript saved to knowledge.');
  }
  async function removeMeeting(meetingId: string) {
    if (!workspace || !window.confirm('Permanently delete this local recording, transcript, and source-owned memory?')) return;
    if(meetingTranscriptionRun?.meetingId===meetingId)await window.waypoint.cancelMeetingTranscription(workspace.id,meetingId,meetingTranscriptionRun.runId);
    await window.waypoint.deleteMeeting(workspace.id, meetingId);
    setMeetings(await window.waypoint.listMeetings(workspace.id));
  }
  function followActivity(item: ActivityTimelineItem) {
    if (item.objectState !== 'available' || !item.targetId || !item.targetKind) return;
    if (item.targetKind === 'chat') {
      setSelectedChatId(item.targetId);
      setDrawer(undefined);
      return;
    }
    if (item.targetKind === 'rule') {
      setDrawer('rules');
      return;
    }
    setActivityKnowledgeTarget(item.targetId);
    setDrawer('knowledge');
  }
  async function refresh(next = workspace) {
    if (!next) return;
    const token = refreshGate.current.begin();
    const [nextChats, nextDocuments, nextMemories, nextSuggestions, nextCommitments, nextActivity, nextProfiles, nextRuns, nextSync, nextDesktop,nextChatModels,nextVoice] = await Promise.all([window.waypoint.listChats(next.id), window.waypoint.listDocuments(next.id), window.waypoint.listMemories(next.id), window.waypoint.listMemorySuggestions(next.id), window.waypoint.listCommitments(next.id), window.waypoint.activity(next.id, { limit: 500 }), window.waypoint.listSecurityProfiles(next.id), window.waypoint.listExecutions(next.id), window.waypoint.syncStatus(next.id), window.waypoint.desktopSyncStatus(next.id),window.waypoint.chatModelPreferences(next.id),window.waypoint.voicePreferences(next.id)]);
    if (!refreshGate.current.isCurrent(token)) return;
    setChats(nextChats);
    setSelectedChatId((current) => reconcileSelectedChatId(nextChats, current));
    setDocuments(nextDocuments);
    setMemories(nextMemories);
    setSuggestions(nextSuggestions);
    setCommitments(nextCommitments);
    setActivity(nextActivity);
    setProfiles(nextProfiles);
    setSelectedProfileId((current)=>nextProfiles.some((item)=>item.id===current)?current:(nextProfiles[0]?.id??''));
    setRuns(nextRuns);
    setNotice((current)=>responseNoticeAfterRuns(current,uniqueChatRuns(nextRuns.filter((run)=>run.chatId===selectedChatId) as ExecutionRunView[])));
    setSyncStatus(nextSync);
    setDesktopSync(nextDesktop);
    setChatModels(nextChatModels);
    setVoiceMode(nextVoice.mode);setVoiceDevice(nextVoice.microphoneId);setVoiceEngine(nextVoice.engine);void window.waypoint.voiceEngineStatus(next.id).then(setVoiceEngineStatus).catch(()=>undefined);
    if (nextDesktop.configured) {
      const [devices, pending,control] = await Promise.all([window.waypoint.syncDevices(next.id).catch(() => []), window.waypoint.pendingSyncEnrollments(next.id).catch(() => []),window.waypoint.deviceControlStatus(next.id)]);
      if (refreshGate.current.isCurrent(token)) {
        setSyncDevices(devices);
        setPendingPeers(pending);
        setDeviceControl(control);
      }
    } else {
      setSyncDevices([]);
      setPendingPeers([]);
      setDeviceControl(undefined);
    }
  }
  async function selectWorkspace(next: WorkspaceSummary) {
    setWorkspace(next);
    setSelectedChatId(undefined);
    setDrawer(undefined);
    await refresh(next);const status=await window.waypoint.activityCaptureStatus(next.id);setActivityCapture(status);setActivityExclusions(status.policy.exclusions.join('\n'));
  }
  useEffect(() => {
    void Promise.all([window.waypoint.bootstrap(), window.waypoint.cliCapabilities()])
      .then(async ([{ workspaces: available }, nextCapabilities]) => {
        setWorkspaces(available);
        setCapabilities(nextCapabilities);
        void window.waypoint.cliModelCatalog().then(setCliModels).catch(()=>undefined);
        if (available[0]) await selectWorkspace(available[0]);
      })
      .catch(showError);
    // Initial bootstrap intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!runs.some((run) => run.status === 'running')) return;
    const timer = window.setInterval(() => void refresh().catch(showError), 750);
    return () => window.clearInterval(timer);
  });
  useEffect(() => {
    if (!workspace || !selectedChatId) return;
    void window.waypoint.listChatAttachments(workspace.id, selectedChatId).then(setAttachments).catch(showError);
  }, [workspace, selectedChatId, chats]);
  useEffect(() => {
    const available = capabilities.find((item) => item.available && item.compatible !== false);
    if(chatCli==='openrouter')return;if (!available || capabilities.some((item) => item.name === chatCli && item.available && item.compatible !== false)) return;
    const timer = window.setTimeout(() => setChatCli(available.name), 0);
    return () => window.clearTimeout(timer);
  }, [capabilities, chatCli]);
  useEffect(()=>{if(!workspace||!selectedChatId||!selectedProfileId||chatCli==='openrouter'){const clear=window.setTimeout(()=>setRouteProposal(undefined),0);return()=>window.clearTimeout(clear)}const token=routeGate.current.begin(),timer=window.setTimeout(()=>{if(routeGate.current.isCurrent(token))setRouteProposal(undefined)},0),ids=attachments.filter((item)=>item.ownerId===selectedChatId).map((item)=>item.id);void window.waypoint.proposeChatRoute(workspace.id,selectedChatId,chatCli,selectedProfileId,ids,false).then((route)=>{if(routeGate.current.isCurrent(token))setRouteProposal(route)}).catch(()=>{if(routeGate.current.isCurrent(token))setRouteProposal(undefined)});return()=>window.clearTimeout(timer)},[workspace,selectedChatId,chatCli,selectedProfileId,attachments]);
  useEffect(()=>{void Promise.resolve().then(refreshOpenRouter).catch(()=>undefined)},[]);
  // Capability refresh is intentionally keyed only to opening the voice surface.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(drawer!=='settings')return;void loadVoiceCapability().catch(showError)},[drawer]);
  useEffect(()=>{voiceStateRef.current=voiceState},[voiceState]);
  useEffect(()=>{transcriptFollowingRef.current=true;requestAnimationFrame(()=>{const element=transcriptRef.current;if(element)element.scrollTop=element.scrollHeight})},[selectedChatId]);
  useEffect(()=>{if(!transcriptFollowingRef.current)return;requestAnimationFrame(()=>{const element=transcriptRef.current;if(element)element.scrollTop=element.scrollHeight})},[chats,runs,selectedChatId]);
  useEffect(()=>{const offChunk=window.waypoint.onVoiceAudioChunk((event)=>{if(event.workspaceId===workspace?.id&&event.chatId===selectedChatId&&event.turnId===voiceTurnRef.current)void voicePlayerRef.current.push(event)}),offEnd=window.waypoint.onVoiceAudioEnd((event)=>voicePlayerRef.current.end(event)),offStop=window.waypoint.onVoiceAudioStop((event)=>void voicePlayerRef.current.stop(event));return()=>{offChunk();offEnd();offStop()}},[workspace,selectedChatId]);
  // Speech completion is accepted only for the exact live turn and visible state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>window.waypoint.onVoiceSpeechState((event)=>{if(event.workspaceId!==workspace?.id||event.chatId!==selectedChatId||event.turnId!==voiceTurnRef.current||voiceStateRef.current!=='speaking')return;if(event.result!=='completed')void voicePlayerRef.current.stop(event);void voiceMonitorRef.current.stop();if(event.result==='failed'){setVoiceSessionActive(false);voiceStateRef.current='off';setVoiceState('off');setVoicePartial('');setError('Local speech playback failed. Open Settings for voice diagnostics.');return}if(event.result==='completed'&&voiceMode==='hands_free'&&voiceSessionActive){voiceStateRef.current='listening';setVoiceState('listening');setVoicePartial('Listening…');void startVoiceCapture(true);return}voiceStateRef.current='off';setVoiceState('off');setVoicePartial('')}),[workspace,selectedChatId,voiceMode,voiceDevice,voiceSessionActive]);
  // The exact-turn refs intentionally guard this asynchronous native speech bridge.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(voiceState!=='thinking'||!workspace||!selectedChatId)return;const voice=voiceRunRef.current;if(!voice||voice.turn!==voiceTurnRef.current||voice.workspaceId!==workspace.id||voice.chatId!==selectedChatId||!voice.runId||voice.spoken)return;const run=runs.find((item)=>String(item.id)===voice.runId);if(!run)return;if(['failed','timed_out','canceled'].includes(String(run.status))){setVoiceSessionActive(false);setVoiceState('off');setVoicePartial('');setError(`Voice turn ${String(run.status).replace('_',' ')}; no stale response will be spoken.`);return}if(run.status!=='completed'||typeof run.assistantMessageId!=='string')return;const chat=chats.find((item)=>item.id===selectedChatId),answer=chat?.messages.find((item)=>item.id===run.assistantMessageId&&item.role==='assistant')?.body;if(!answer?.trim())return;voice.spoken=true;const turn=voice.turn;setVoicePartial('Speaking… say something to interrupt');voiceStateRef.current='speaking';setVoiceState('speaking');void window.waypoint.speakVoice(workspace.id,selectedChatId,turn,answer).then(async()=>{if(turn!==voiceTurnRef.current||voiceStateRef.current!=='speaking')return;if(voiceMode==='hands_free'&&voiceSessionActive)await voiceMonitorRef.current.start(voiceDevice||undefined,()=>void bargeInVoice(turn),()=>void finishBargeCapture(turn),reason=>void failVoiceCapture(reason)).catch((reason)=>{setError(`Barge-in monitor unavailable: ${reason instanceof Error?reason.message:String(reason)}. Playback can still be stopped with the voice control.`)})}).catch((reason)=>{if(turn===voiceTurnRef.current){setVoiceSessionActive(false);voiceStateRef.current='off';setVoiceState('off');setVoicePartial('');showError(reason)}})},[voiceState,workspace,selectedChatId,chats,runs,voiceMode,voiceSessionActive,voiceDevice]);
  useEffect(()=>{const prior=voiceScopeRef.current,next={workspaceId:workspace?.id,chatId:selectedChatId},changed=Boolean(prior.workspaceId&&(prior.workspaceId!==next.workspaceId||prior.chatId!==next.chatId));voiceScopeRef.current=next;if(changed){voiceTurnRef.current++;voiceCaptureTargetRef.current=undefined;voiceStateRef.current='off';setVoiceSessionActive(false);setVoiceState('off');setVoicePartial('');void voiceCaptureRef.current.cancel();void voiceMonitorRef.current.stop();if(prior.workspaceId&&prior.chatId)void window.waypoint.stopVoice(prior.workspaceId,prior.chatId).catch(()=>undefined)}},[workspace,selectedChatId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawer(undefined);
        setSidebarOpen(false);
      }
      if (event.metaKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void beginNewChat();
      }
      if (event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDrawer('knowledge');
      }
      if(event.metaKey&&event.shiftKey&&event.key.toLowerCase()==='p'&&activityCapture?.policy.enabled&&!activityCapture.policy.paused){event.preventDefault();void updateActivityCapture({paused:true}).catch(showError)}
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (drawer !== 'knowledge' || !activityKnowledgeTarget) return;
    const timer = window.setTimeout(() => document.getElementById(`activity-target-${activityKnowledgeTarget}`)?.scrollIntoView({ block: 'center' }), 0);
    return () => window.clearTimeout(timer);
  }, [drawer, activityKnowledgeTarget]);
  useEffect(()=>{if(drawer!=='settings'||!workspace)return;let current=true;void Promise.all([window.waypoint.toolGatewaySettings(workspace.id),window.waypoint.toolGatewayReceipts(workspace.id),window.waypoint.toolFailures(workspace.id),window.waypoint.toolGatewayCapabilities(),window.waypoint.openRouterStatus()]).then(([settings,receipts,failures,caps,provider])=>{if(!current)return;setToolSettings(settings);setDenyDraft(settings.denyPatterns.join('\n'));setToolReceipts(receipts);setToolFailures(failures);setToolCapabilities(caps);setOpenRouter(provider)}).catch(showError);return()=>{current=false}},[drawer,workspace]);
  useEffect(()=>{if(drawer!=='settings'||!workspace)return;let current=true;void window.waypoint.crossWorkspaceRollupSettings(workspace.id).then((value)=>{if(current)setRollupSettings(value)}).catch(showError);return()=>{current=false}},[drawer,workspace]);
  useEffect(()=>{if(drawer!=='knowledge'||!workspace)return;let current=true;void Promise.all(documents.map(async(item)=>[item.id,await window.waypoint.documentIndexStatus(workspace.id,item.id)] as const)).then((entries)=>{if(current)setDocumentIndexes(Object.fromEntries(entries))}).catch(showError);return()=>{current=false}},[drawer,workspace,documents]);
  useEffect(()=>{if(drawer!=='activity'||!workspace)return;let current=true;void Promise.all([window.waypoint.activityCaptureStatus(workspace.id),window.waypoint.listActivitySnapshots(workspace.id,activitySnapshotQuery)]).then(([status,snapshots])=>{if(!current)return;setActivityCapture(status);setActivitySnapshots(snapshots);setActivityExclusions(status.policy.exclusions.join('\n'))}).catch(showError);return()=>{current=false}},[drawer,workspace,activitySnapshotQuery]);
  useEffect(()=>{if(drawer==='activity')return;const timer=window.setTimeout(()=>setActivityPreview(undefined),0);return()=>window.clearTimeout(timer)},[drawer]);
  useEffect(() => {
    if (!drawer && !sidebarOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const focusable = () => [...overlay.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
    window.setTimeout(() => focusable()[0]?.focus(), 0);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0],
        last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener('keydown', trap);
    return () => {
      overlay.removeEventListener('keydown', trap);
      previousFocusRef.current?.focus();
    };
  }, [drawer, sidebarOpen]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await window.waypoint.createWorkspace(String(new FormData(event.currentTarget).get('name') ?? ''));
      setWorkspaces((current) => [...current, created]);
      await selectWorkspace(created);
    } catch (reason) {
      showError(reason);
    }
  }
  async function beginNewChat() {
    if (!workspace) return;
    try {
      const id = await window.waypoint.createChat(workspace.id, 'New chat');
      await refresh();
      setSelectedChatId(id);
      setSidebarOpen(false);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    } catch (reason) {
      showError(reason);
    }
  }
  async function chooseAttachments() {
    if (!workspace || !selectedChatId) return;
    setAttachmentBusy(true);
    try {
      const result = await window.waypoint.selectChatAttachments(workspace.id, selectedChatId);
      setAttachments(result.attachments);
    } catch (reason) {
      showError(reason);
    } finally {
      setAttachmentBusy(false);
    }
  }
  async function importDocument(){if(!workspace)return;setDocumentImportBusy(true);setError('');try{const result=await window.waypoint.importDocument(workspace.id);if(result.canceled)return;if(result.state==='failed'){setError(result.message??'Local document extraction failed.');return}setNotice(result.state==='indexed'?`${result.sourceName} imported and indexed in ${result.chunkCount} local chunks with ${result.model}.`:result.state==='provider_unavailable'?`${result.sourceName} imported for lexical search. ${result.model} is unavailable, so semantic indexing is waiting.`:`${result.sourceName} imported for lexical search. ${result.message??'Local semantic indexing is busy or failed; retry from Knowledge.'}`);await refresh()}catch(reason){showError(reason)}finally{setDocumentImportBusy(false)}}
  async function reindexDocument(documentId:string){if(!workspace)return;setDocumentImportBusy(true);setError('');try{const result=await window.waypoint.reindexImportedDocument(workspace.id,documentId);setNotice(result.state==='indexed'?`Local semantic index rebuilt in ${result.chunkCount} chunks with ${result.model}.`:result.state==='provider_unavailable'?`${result.model} is unavailable. The imported document remains available to lexical search.`:result.message??'Local semantic indexing is busy or failed.');if(result.state==='indexed')setDocumentIndexes((current)=>({...current,[documentId]:{...current[documentId],state:'indexed',chunkCount:result.chunkCount,sourceAvailable:true,provider:result.provider,model:result.model,modelDigest:result.modelDigest,retainedGenerations:Math.max(1,current[documentId]?.retainedGenerations??0)}}))}catch(reason){showError(reason)}finally{setDocumentImportBusy(false)}}
  async function rollbackDocumentIndex(documentId:string){if(!workspace)return;setDocumentImportBusy(true);try{const result=await window.waypoint.rollbackDocumentIndex(workspace.id,documentId);setDocumentIndexes((current)=>({...current,[documentId]:result}));setNotice(`Prior complete index generation selected (${result.model}). Semantic search resumes only when its exact local model digest is installed.`)}catch(reason){showError(reason)}finally{setDocumentImportBusy(false)}}
  async function removeAttachment(id: string) {
    if (!workspace || !selectedChatId) return;
    setAttachmentBusy(true);
    try {
      await window.waypoint.deleteAttachment(workspace.id, id);
      setAttachments(await window.waypoint.listChatAttachments(workspace.id, selectedChatId));
    } catch (reason) {
      showError(reason);
    } finally {
      setAttachmentBusy(false);
    }
  }
  async function updateActivityCapture(patch:Partial<ActivityCaptureStatus['policy']>){if(!workspace||!activityCapture)return;const exclusions=(patch.exclusions??activityExclusions.split('\n').map((item)=>item.trim()).filter(Boolean));const status=await window.waypoint.updateActivityCapture(workspace.id,{...activityCapture.policy,...patch,exclusions});setActivityCapture(status);setActivityExclusions(status.policy.exclusions.join('\n'));setActivitySnapshots(await window.waypoint.listActivitySnapshots(workspace.id,activitySnapshotQuery))}
  async function removeActivitySnapshot(id:string){if(!workspace)return;await window.waypoint.deleteActivitySnapshot(workspace.id,id);setActivitySnapshots(await window.waypoint.listActivitySnapshots(workspace.id,activitySnapshotQuery));setActivityCapture(await window.waypoint.activityCaptureStatus(workspace.id))}
  async function previewActivitySnapshot(id:string){if(!workspace)return;const value=await window.waypoint.readActivitySnapshot(workspace.id,id);setActivityPreview({id,url:`data:${value.mediaType};base64,${value.dataBase64}`})}
  async function removeAllActivitySnapshots(){if(!workspace)return;const result=await window.waypoint.deleteAllActivitySnapshots(workspace.id);setNotice(`${result.deleted} raw activity snapshot${result.deleted===1?'':'s'} permanently deleted.`);setActivitySnapshots([]);setActivityCapture(await window.waypoint.activityCaptureStatus(workspace.id))}
  async function loadVoiceCapability(){const capability=await window.waypoint.voiceCapability();setVoiceCapability(capability);if(workspace)setVoiceEngineStatus(await window.waypoint.voiceEngineStatus(workspace.id));if(navigator.mediaDevices?.enumerateDevices){const devices=(await navigator.mediaDevices.enumerateDevices()).filter((item)=>item.kind==='audioinput');setVoiceDevices(devices);if(!voiceDevice&&devices[0])setVoiceDevice(devices[0].deviceId)}return capability}
  async function failVoiceCapture(reason:'device_lost'|'capture_limit'){await stopVoiceMode();setError(reason==='device_lost'?'The selected microphone disconnected. Open Settings to choose another device.':'The two-minute voice capture limit was reached.')}
  async function startVoiceCapture(interruptionAlreadyHandled=false){if(!workspace||!selectedChat)return;const attempt=voiceTurnRef.current,target={workspaceId:workspace.id,chatId:selectedChat.id};voiceCaptureTargetRef.current=target;setError('');try{const capability=voiceCapability??await loadVoiceCapability();if(!capability.stt.available){voiceCaptureTargetRef.current=undefined;setVoiceSessionActive(false);setError(`${capability.stt.reason} Open Settings for voice diagnostics.`);return}if(!interruptionAlreadyHandled&&(voiceStateRef.current==='thinking'||voiceStateRef.current==='speaking')){const exact=voiceRunRef.current;if(exact?.runId)await cancelRun(exact.runId);await window.waypoint.stopVoice(target.workspaceId,target.chatId)}await voiceCaptureRef.current.start(voiceDevice||undefined,(reason)=>void failVoiceCapture(reason),voiceMode==='hands_free'?()=>void finishVoiceCapture():undefined);const scope=voiceScopeRef.current;if(attempt!==voiceTurnRef.current||scope.workspaceId!==target.workspaceId||scope.chatId!==target.chatId){await voiceCaptureRef.current.cancel();return}voiceTurnRef.current++;voiceRunRef.current=undefined;setVoicePartial('Listening…');voiceStateRef.current='listening';setVoiceState('listening');if(voiceMode==='push_to_talk'&&voicePressReleasedRef.current)await finishVoiceCapture()}catch(reason){voiceCaptureTargetRef.current=undefined;setVoiceSessionActive(false);voiceStateRef.current='off';setVoiceState('off');setVoicePartial('');showError(reason)}}
  async function bargeInVoice(turn:number){if(!workspace||!selectedChat||voiceMode!=='hands_free'||!voiceSessionActive||turn!==voiceTurnRef.current||voiceStateRef.current!=='speaking')return;const target={workspaceId:workspace.id,chatId:selectedChat.id},stop=window.waypoint.stopVoice(target.workspaceId,target.chatId);voiceStateRef.current='listening';setVoiceState('listening');setVoicePartial('Listening…');await stop;if(turn!==voiceTurnRef.current||voiceScopeRef.current.workspaceId!==target.workspaceId||voiceScopeRef.current.chatId!==target.chatId)await voiceMonitorRef.current.stop()}
  async function finishBargeCapture(turn:number){const scope=voiceScopeRef.current;if(!workspace||!selectedChat||turn!==voiceTurnRef.current||scope.workspaceId!==workspace.id||scope.chatId!==selectedChat.id||voiceStateRef.current!=='listening')return;const target={workspaceId:workspace.id,chatId:selectedChat.id};voiceStateRef.current='transcribing';setVoiceState('transcribing');setVoicePartial('Transcribing locally…');let wav:Uint8Array|undefined;try{wav=await voiceMonitorRef.current.finish();if(turn!==voiceTurnRef.current||voiceScopeRef.current.workspaceId!==target.workspaceId||voiceScopeRef.current.chatId!==target.chatId)return;const result=await window.waypoint.transcribeVoice(target.workspaceId,target.chatId,'hands_free',wav),prompt=result.text.trim();if(turn!==voiceTurnRef.current||voiceScopeRef.current.workspaceId!==target.workspaceId||voiceScopeRef.current.chatId!==target.chatId)return;if(!prompt)throw new Error('The local runtime returned an empty transcript.');const textarea=composerRef.current;if(!textarea)throw new Error('Voice target changed; the transcript was not submitted.');textarea.value=prompt;voiceSubmissionRef.current=turn;voiceRunRef.current={turn,workspaceId:target.workspaceId,chatId:target.chatId};voiceStateRef.current='thinking';setVoiceState('thinking');setVoicePartial('Thinking…');textarea.form?.requestSubmit()}catch(reason){if(turn===voiceTurnRef.current){setVoiceSessionActive(false);voiceStateRef.current='off';setVoiceState('off');setVoicePartial('');showError(reason)}}finally{wav?.fill(0)}}
  async function finishVoiceCapture(){const target=voiceCaptureTargetRef.current;if(!workspace||!selectedChat||!target||voiceStateRef.current!=='listening')return;const turn=voiceTurnRef.current;let wav:Uint8Array|undefined;voiceStateRef.current='transcribing';setVoiceState('transcribing');setVoicePartial('Transcribing locally…');try{wav=await voiceCaptureRef.current.stop();if(turn!==voiceTurnRef.current||workspace.id!==target.workspaceId||selectedChat.id!==target.chatId)return;const result=await window.waypoint.transcribeVoice(target.workspaceId,target.chatId,voiceMode,wav);if(turn!==voiceTurnRef.current||workspace.id!==target.workspaceId||selectedChat.id!==target.chatId)return;const prompt=result.text.trim();if(!prompt)throw new Error('The local runtime returned an empty transcript.');setVoicePartial('Thinking…');const textarea=composerRef.current;if(!textarea||selectedChatId!==target.chatId)throw new Error('Voice target changed; the transcript was not submitted.');textarea.value=prompt;voiceSubmissionRef.current=turn;voiceRunRef.current={turn,workspaceId:target.workspaceId,chatId:target.chatId};voiceStateRef.current='thinking';setVoiceState('thinking');textarea.form?.requestSubmit()}catch(reason){if(turn===voiceTurnRef.current){setVoiceSessionActive(false);voiceStateRef.current='off';setVoiceState('off');setVoicePartial('');showError(reason)}}finally{voiceCaptureTargetRef.current=undefined;wav?.fill(0)}}
  async function stopVoiceMode(){setVoiceSessionActive(false);voiceTurnRef.current++;voiceSubmissionRef.current=undefined;voiceCaptureTargetRef.current=undefined;await Promise.all([voiceCaptureRef.current.cancel(),voiceMonitorRef.current.stop(),voicePlayerRef.current.stop()]);if(workspace&&selectedChat)await window.waypoint.stopVoice(workspace.id,selectedChat.id).catch(()=>undefined);const exact=voiceRunRef.current;if(exact?.runId)await cancelRun(exact.runId).catch(()=>undefined);voiceRunRef.current=undefined;voiceStateRef.current='off';setVoiceState('off');setVoicePartial('')}
  async function toggleHandsFree(){if(voiceSessionActive){await stopVoiceMode();return}setVoiceSessionActive(true);await startVoiceCapture()}
  function beginPushToTalk(){voicePressReleasedRef.current=false;void startVoiceCapture()}
  function releasePushToTalk(){voicePressReleasedRef.current=true;void finishVoiceCapture()}
  async function saveVoicePreferences(nextMode=voiceMode,nextDevice=voiceDevice,nextEngine=voiceEngine){if(!workspace)return;const value=await window.waypoint.updateVoicePreferences(workspace.id,{mode:nextMode,microphoneId:nextDevice,outputVoice:'system',engine:nextEngine});setVoiceMode(value.mode);setVoiceDevice(value.microphoneId);setVoiceEngine(value.engine);setVoiceEngineStatus(await window.waypoint.voiceEngineStatus(workspace.id));setNotice('Voice preferences saved for this workspace on this device.')}
  async function runChat(event: FormEvent<HTMLFormElement>, chatId: string) {
    event.preventDefault();
    if (!workspace) return;
    const form = event.currentTarget,
      data = new FormData(form),
      prompt = String(data.get('prompt') ?? ''),
      cli = String(data.get('cli') ?? chatCli) as 'codex' | 'claude'|'openrouter',
      profile = String(data.get('profile') ?? ''),
      model = String(data.get('model') ?? '') || undefined,
      attachmentIds = attachments.filter((item) => item.ownerId === chatId).map((item) => item.id);
    setError('');const voiceTurn=voiceSubmissionRef.current;if(voiceTurn!==undefined)voiceSubmissionRef.current=undefined;
    try {
      if(cli==='openrouter'&&attachmentIds.length)throw new Error('OpenRouter file delivery is not enabled. Remove attachments or use an eligible local CLI; files remain local.');
      const messageId = await window.waypoint.addMessage(workspace.id, chatId, 'user', prompt, attachmentIds);
      if(voiceTurn!==undefined&&voiceRunRef.current?.turn===voiceTurn)voiceRunRef.current.sourceMessageId=messageId;
      if(cli==='openrouter'){const hosted=await window.waypoint.runOpenRouterChat({workspaceId:workspace.id,chatId,sourceMessageId:messageId,prompt,role:'everyday',attachmentIds});let exactRunId:string,runKind:'hosted'|'local';if(hosted.fallbackProvider){const fallback=await window.waypoint.runChat(workspace.id,chatId,messageId,hosted.fallbackProvider,profile,prompt,model,undefined,[]);exactRunId=fallback.runId;runKind='local';setNotice(hosted.reason??`Hosted cap reached; ${hosted.fallbackProvider} subscription fallback started.`)}else{if(typeof hosted.runId!=='string')throw new Error('Hosted voice run did not return an execution identity.');exactRunId=hosted.runId;runKind='hosted';setNotice(`OpenRouter ${hosted.model} is responding within the reserved per-request cap…`)}if(voiceTurn!==undefined){if(voiceTurn!==voiceTurnRef.current)await cancelLateVoiceRun(runKind,workspace.id,exactRunId,window.waypoint);else if(voiceRunRef.current?.turn===voiceTurn)voiceRunRef.current.runId=exactRunId}form.reset();await refresh();return}
      const started = await window.waypoint.runChat(workspace.id, chatId, messageId, cli, profile, prompt, model, undefined, attachmentIds);
      if(voiceTurn!==undefined&&voiceRunRef.current?.turn===voiceTurn)voiceRunRef.current.runId=started.runId;if(voiceTurn!==undefined&&voiceTurn!==voiceTurnRef.current)await cancelRun(started.runId);
      form.reset();
      const unsupported = started.attachmentDelivery.unsupported;
      setNotice(unsupported.length ? `${unsupported.length} attachment${unsupported.length === 1 ? ' remains' : 's remain'} local because ${cli} cannot accept the file type.` : `${cli} is responding…`);
      await refresh();
    } catch (reason) {
      if(voiceTurn!==undefined&&voiceRunRef.current?.turn===voiceTurn){setVoiceSessionActive(false);voiceStateRef.current='off';setVoiceState('off');setVoicePartial('');voiceRunRef.current=undefined}
      showError(reason);
      await refresh().catch(showError);
      setAttachments(await window.waypoint.listChatAttachments(workspace.id, chatId).catch(() => []));
    }
  }
  async function retryRun(run: ExecutionRunView) {
    if (!workspace || !selectedChat) return;
    const source = selectedChat.messages.find((message) => message.id === String(run.sourceMessageId ?? '') && message.role === 'user');
    if (!source) {
      setError('This older run has no exact source message and cannot be retried safely.');
      return;
    }
    const ids = attachments.filter((item) => item.ownerId === source.id).map((item) => item.id);
    try {
      await window.waypoint.runChat(workspace.id, selectedChat.id, source.id, String(run.cli) as 'codex' | 'claude', String(run.securityProfileId), source.body, run.model ? String(run.model) : undefined, undefined, ids);
      setNotice('Retry started.');
      await refresh();
    } catch (reason) {
      showError(reason);
      await refresh().catch(showError);
    }
  }
  async function cancelRun(id: string) {
    try {
      const run=runs.find((item)=>item.id===id);if(run?.cli==='openrouter')await window.waypoint.cancelOpenRouterRun(workspace!.id,id);else await window.waypoint.cancelExecution(id);
      setNotice(run?.cli==='openrouter'?'Stopping the hosted request…':'Stopping the local CLI…');
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  function executionHistory(run:ExecutionRunView){const events=uniqueExecutionEvents(run),toolEvents=events.filter((event)=>['tool','agent','diagnostic','provider','progress','terminal','policy'].includes(String(event.type))),text=events.filter((event)=>event.type==='text').map((event)=>String(event.text??'')).join('');return <Fragment key={`execution-${String(run.id)}`}><details className="execution-timeline" open={run.status==='running'}><summary><span className="status-dot"/><strong>{String(run.cli)} execution · {String(run.status).replace('_',' ')}</strong><small>{toolEvents.length?`${toolEvents.length} structured event${toolEvents.length===1?'':'s'}`:'No provider tool events exposed'}</small></summary><ol>{toolEvents.map((event,index)=><li key={`${String(run.id)}-${String(event.sequence??index)}`}><b>{event.type==='tool'?String(event.name??'Tool action'):event.type==='agent'?String(event.name??'Agent event'):String(event.type??'Provider status')}</b>{typeof event.text==='string'&&<span>{event.text.slice(0,1000)}</span>}<small>{event.createdAt?new Date(String(event.createdAt)).toLocaleTimeString():''}</small></li>)}</ol>{!toolEvents.length&&<p>This provider did not expose an internal tool event for this run. Waypoint does not infer or invent one.</p>}</details>{run.status!=='completed'&&<article className={`run-strip ${String(run.status)}`}><div><span className="status-dot"/><strong>{run.status==='running'?`${run.cli} is responding`:String(run.status).replace('_',' ')}</strong>{text&&<ChatMarkdown body={text}/>} {failureAdvice(run)&&<small>{failureAdvice(run)}</small>}</div><div>{run.status==='running'&&<button onClick={()=>void cancelRun(String(run.id))}>Stop</button>}{['failed','timed_out','canceled'].includes(String(run.status))&&<button onClick={()=>void retryRun(run)}>Retry</button>}</div></article>}</Fragment>}
  async function delegateTask(){if(!workspace||!selectedChat)return;const parent=runs.find((item)=>item.chatId===selectedChat.id&&Number(item.depth)===0&&item.cli==='claude'&&item.status==='completed'&&Array.isArray(item.events)&&item.events.some((event)=>event&&typeof event==='object'&&(event as Record<string,unknown>).type==='text'&&String((event as Record<string,unknown>).text??'').trim())&&!runs.some((child)=>child.parentExecutionId===item.id));if(!parent){setError('No completed Claude result has an unused child-task budget. Codex child tasks remain unavailable until a reviewed no-tool mode exists.');return}const type=window.prompt('Task type: analyze, summarize, or critique','critique')?.trim() as 'analyze'|'summarize'|'critique'|undefined;if(!type)return;const instruction=window.prompt('Bounded child instruction','Critique the prior answer for correctness and missing risks.')?.trim();if(!instruction)return;const source=selectedChat.messages.find((item)=>item.id===String(parent.sourceMessageId));if(!source){setError('The parent source message is unavailable.');return}try{await window.waypoint.runChat(workspace.id,selectedChat.id,source.id,'claude',String(parent.securityProfileId),instruction,parent.model?String(parent.model):undefined,String(parent.id),[],type);setNotice(`${type} child task started with the parent profile and a 60-second cap.`);await refresh()}catch(reason){showError(reason);await refresh().catch(showError)}}
  async function remove(kind: 'document' | 'chat' | 'memory', id: string) {
    if (!workspace || !window.confirm(`Delete this ${kind} and its owned local data? This cannot be undone.`)) return;
    try {
      await window.waypoint.deleteObject(workspace.id, kind, id);
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function saveMessageToKnowledge(messageId: string) {
    if (!workspace) return;
    try {
      await window.waypoint.captureMessageAsDocument(workspace.id, messageId);
      setNotice('Saved to local knowledge.');
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function editDocument(item: Document) {
    if (!workspace) return;
    const title = window.prompt('Note title', item.title);
    if (title === null) return;
    const body = window.prompt('Note text', item.body);
    if (body === null) return;
    try {
      await window.waypoint.updateDocument(workspace.id, item.id, title, body);
      setNotice('Note updated locally.');
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function scanSuggestions() {
    if (!workspace) return;
    try {
      const result = await window.waypoint.scanMemorySuggestions(workspace.id, selectedChatId);
      setNotice(result.created ? `${result.created} reviewable suggestion${result.created === 1 ? '' : 's'} found locally.` : 'No new explicit suggestions found.');
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function resolveSuggestion(item: MemorySuggestion, action: 'accept' | 'reject', edit = false) {
    if (!workspace) return;
    let title = item.title,
      body = item.body;
    if (edit) {
      const nextTitle = window.prompt('Suggestion title', title);
      if (nextTitle === null) return;
      const nextBody = window.prompt('Suggestion text', body);
      if (nextBody === null) return;
      title = nextTitle;
      body = nextBody;
    }
    try {
      await window.waypoint.resolveMemorySuggestion(workspace.id, item.id, action, ...(action === 'accept' ? ([title, body] as const) : []));
      setNotice(action === 'accept' ? 'Saved with source provenance.' : 'Suggestion rejected; no memory was created.');
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function toggleCommitment(item: Commitment) {
    if (!workspace) return;
    try {
      await window.waypoint.setCommitmentCompleted(workspace.id, item.id, item.status === 'open');
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function openBriefing() {
    if (!workspace) return;
    try {
      setBriefing(await window.waypoint.composeDailyBriefing(workspace.id, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
      setSidebarOpen(false);
      setDrawer('briefing');
    } catch (reason) {
      showError(reason);
    }
  }
  async function dismissBriefing(item: Briefing['items'][number]) {
    if (!workspace || !briefing) return;
    try {
      await window.waypoint.dismissBriefingItem(workspace.id, item.id, item.kind, briefing.localDay);
      setBriefing(await window.waypoint.composeDailyBriefing(workspace.id, briefing.timezone));
    } catch (reason) {
      showError(reason);
    }
  }
  async function openRules() {
    if (!workspace) return;
    try {
      const [suggested, rules, graph] = await Promise.all([window.waypoint.listRuleSuggestions(workspace.id), window.waypoint.listLearnedRules(workspace.id), window.waypoint.graph(workspace.id)]);
      setRuleSuggestions(suggested);
      setLearnedRules(rules);
      setKnowledgeGraph(graph);
      setSidebarOpen(false);
      setDrawer('rules');
    } catch (reason) {
      showError(reason);
    }
  }
  async function scanRules() {
    if (!workspace) return;
    try {
      const result = await window.waypoint.scanRuleSuggestions(workspace.id);
      setNotice(result.created ? `${result.created} repeated directive${result.created === 1 ? '' : 's'} ready for review.` : 'No new repeated directives found.');
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function dryRunRule(item: RuleSuggestion) {
    if (!workspace) return;
    try {
      const result = await window.waypoint.dryRunRuleSuggestion(workspace.id, item.id);
      setNotice(`Dry run matched ${result.matchCount} current source messages; nothing was changed.`);
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function resolveRule(item: RuleSuggestion, action: 'approve' | 'reject') {
    if (!workspace) return;
    try {
      await window.waypoint.resolveRuleSuggestion(workspace.id, item.id, action);
      setNotice(action === 'approve' ? 'Advisory workspace rule approved.' : 'Rule suggestion rejected.');
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function toggleRule(item: LearnedRule) {
    if (!workspace) return;
    try {
      await window.waypoint.setLearnedRuleEnabled(workspace.id, item.id, !item.enabled);
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function revertRule(item: LearnedRule) {
    if (!workspace) return;
    try {
      await window.waypoint.revertLearnedRule(workspace.id, item.id);
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function runHealth() {
    if (!workspace) return;
    setChecking(true);
    try {
      setDiagnostics(await window.waypoint.diagnostics(workspace.id));
    } catch (reason) {
      showError(reason);
    } finally {
      setChecking(false);
    }
  }
  async function exportWorkspace() {
    if (!workspace) return;
    try {
      const result = await window.waypoint.exportWorkspace(workspace.id);
      if (!result.canceled) setNotice('Protected-location reminder shown; backup saved and verified.');
    } catch (reason) {
      showError(reason);
    }
  }
  async function restoreWorkspace() {
    try {
      const result = await window.waypoint.restoreWorkspace();
      if (result.workspace) {
        setWorkspaces((current) => [...current, result.workspace!]);
        await selectWorkspace(result.workspace);
      }
    } catch (reason) {
      showError(reason);
    }
  }
  async function verifyBackup(){try{const result=await window.waypoint.verifyBackup();if(result.canceled)return;if(result.status==='passed')setNotice(`${result.fileName} passed integrity and format checks (${result.totalObjects} portable objects).`);else setError(`${result.code}: ${result.remediation}`)}catch(reason){showError(reason)}}
  async function drillBackup(){try{const result=await window.waypoint.drillBackup();if(result.canceled)return;if(result.status==='passed'&&result.drill)setNotice(`${result.fileName} restored successfully in isolation; temporary drill data was removed.`);else setError(`${result.code}: ${result.remediation}`)}catch(reason){showError(reason)}}
  async function initializeSync() {
    if (!workspace) return;
    try {
      const result = await window.waypoint.initializeDesktopSync(workspace.id);
      if (result.bootstrap) {
        setBootstrapBundle(JSON.stringify(result.bootstrap));
        setNotice('Protected owner identity created. Host on this device for direct peer sync, or explicitly configure the optional hosted relay.');
      }
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function invitePeer() {
    if (!workspace) return;
    try {
      const result = await window.waypoint.createSyncInvitation(workspace.id);
      await navigator.clipboard.writeText(result.token);
      setNotice(`One-use invitation copied. It expires ${new Date(result.expiresAt).toLocaleTimeString()}.`);
    } catch (reason) {
      showError(reason);
    }
  }
  async function joinSync() {
    const token = window.prompt('Paste the one-use Waypoint enrollment token');
    if (!token) return;
    try {
      const result = await window.waypoint.submitSyncEnrollment(token);
      setNotice('Enrollment requested. After the owner approves, choose Complete enrollment.');
      if (workspaces.some((item) => item.id === result.workspaceId)) await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function completeSync() {
    if (!workspace) return;
    try {
      await window.waypoint.completeSyncEnrollment(workspace.id);
      setNotice('This device is enrolled and the workspace key is protected locally.');
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function approvePeer(requestId: string) {
    if (!workspace) return;
    try {
      const result = await window.waypoint.approveSyncEnrollment(workspace.id, requestId);
      if (!result.canceled) {
        setNotice('Device approved.');
        await refresh();
      }
    } catch (reason) {
      showError(reason);
    }
  }
  async function revokePeer(deviceId: string) {
    if (!workspace) return;
    try {
      const result = await window.waypoint.revokeSyncDevice(workspace.id, deviceId);
      if (!result.canceled) {
        setNotice(`Device revoked; key epoch ${result.rotation?.keyEpoch} is active.`);
        await refresh();
      }
    } catch (reason) {
      showError(reason);
    }
  }
  async function toggleDeviceWorker(){if(!workspace||!deviceControl)return;try{const result=await window.waypoint.updateDeviceControl(workspace.id,{...deviceControl.policy,enabled:!deviceControl.policy.enabled});if(!result.canceled){setNotice(result.policy.enabled?'This device now accepts the listed trusted commands.':'This device worker is disabled.');await refresh()}}catch(reason){showError(reason)}}
  async function dispatchDeviceSummary(targetDeviceId:string){if(!workspace)return;try{await window.waypoint.dispatchDeviceCommand(workspace.id,targetDeviceId,'Return a bounded workspace summary',crypto.randomUUID());setNotice('Encrypted command queued for the selected trusted device.');await window.waypoint.syncNow(workspace.id);await refresh()}catch(reason){showError(reason)}}

  if (!workspace)
    return (
      <main className="onboarding">
        <img className="brand-mark" src={waypointMark} alt="Waypoint" />
        <p className="kicker">Private by default</p>
        <h1>
          Your thinking,
          <br />
          close at hand.
        </h1>
        <p>Waypoint keeps conversations and knowledge on this computer and uses only the signed-in CLI you choose.</p>
        <form onSubmit={createWorkspace}>
          <label>
            Workspace name
            <input name="name" required maxLength={120} autoFocus placeholder="Personal" />
          </label>
          <button>Create workspace</button>
        </form>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
      </main>
    );

  const selectedChat = chats.find((chat) => chat.id === selectedChatId),
    chatRuns = uniqueChatRuns(runs.filter((run) => run.chatId === selectedChatId) as ExecutionRunView[]),
    queued = attachments.filter((item) => item.ownerId === selectedChatId),
    historyGroups = groupChatHistory(chats, historyQuery, historySort),selectedComposerModel=chatCli==='openrouter'?(openRouter?.settings.everydayModel??''):chatModels[chatCli],composerModelChoices=chatCli==='openrouter'?openRouterModelChoices(selectedComposerModel).map((item)=>({id:item.id,label:`${item.name} — ${item.id}${item.legacy?' (saved legacy/custom)':''}`})):withLegacyModel(cliModels.find((item)=>item.provider===chatCli)?.models??[{id:'',label:`${chatCli} default (CLI selected)`}],selectedComposerModel),codexModelChoices=withLegacyModel(cliModels.find((item)=>item.provider==='codex')?.models??[{id:'',label:'Codex default (CLI selected)'}],chatModels.codex),claudeModelChoices=withLegacyModel(cliModels.find((item)=>item.provider==='claude')?.models??[{id:'',label:'Claude default (CLI selected)'}],chatModels.claude);
  return (
    <div className="app-frame">
      <button className="mobile-menu icon-button" aria-label="Open conversations" onClick={() => setSidebarOpen(true)}>
        ☰
      </button>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close conversations" onClick={() => setSidebarOpen(false)} />}
      <aside ref={sidebarOpen ? overlayRef : undefined} className={`left-sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Primary navigation" role={sidebarOpen ? 'dialog' : undefined} aria-modal={sidebarOpen || undefined}>
        <div className="wordmark">
          <img src={waypointMark} alt="" />
          <strong>Waypoint</strong>
        </div>
        <button className="new-chat" onClick={() => void beginNewChat()}>
          <span>＋</span> New chat <kbd>⌘N</kbd>
        </button>
        <div className="history-tools">
          <label>
            <span className="sr-only">Search conversations</span>
            <b>⌕</b>
            <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Search chats" />
          </label>
          <select value={historySort} onChange={(event) => setHistorySort(event.target.value as HistorySort)} aria-label="Sort conversations">
            <option value="recent">Recent</option>
            <option value="title">A–Z</option>
          </select>
        </div>
        <nav className="conversation-list" aria-label="Conversations">
          {historyGroups.map((group) => (
            <section key={group.label} aria-labelledby={`history-${group.label.replaceAll(' ', '-')}`}>
              <h2 id={`history-${group.label.replaceAll(' ', '-')}`}>{group.label}</h2>
              {group.items.map((item) => {
                const chat = chats.find((candidate) => candidate.id === item.id)!;
                return (
                  <div className={`conversation-row ${chat.id === selectedChatId ? 'active' : ''}`} key={chat.id}>
                    <button
                      className="conversation-select"
                      aria-current={chat.id === selectedChatId ? 'page' : undefined}
                      onClick={() => {
                        setSelectedChatId(chat.id);
                        setSidebarOpen(false);
                        setDrawer(undefined);
                      }}
                    >
                      <span>{chat.title}</span>
                      <small>{chat.messages.at(-1)?.body || 'No messages yet'}</small>
                    </button>
                    <button className="conversation-delete" aria-label={`Delete ${chat.title}`} onClick={() => void remove('chat', chat.id)}>
                      ×
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
          {!historyGroups.length && <p className="sidebar-empty">{historyQuery ? 'No matching conversations.' : 'Your conversations will live here.'}</p>}
        </nav>
        <nav className="utility-nav" aria-label="Workspace tools">
          <button onClick={() => void openBriefing()}>
            <span>☀</span> Briefing
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              setDrawer('knowledge');
            }}
          >
            <span>⌘</span> Knowledge <kbd>⌘K</kbd>
          </button>
          <button onClick={() => void openRules()}>
            <span>◇</span> Graph &amp; rules
          </button>
          <button onClick={() => void openReflection().catch(showError)}>
            <span>✦</span> Reflect
          </button>
          <button onClick={() => void openMeetings().catch(showError)}>
            <span>◉</span> Meetings
          </button>
          <button onClick={() => void openAutomations().catch(showError)}>
            <span>↻</span> Automations
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              setDrawer('activity');
            }}
          >
            <span>↗</span> Activity
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              setDrawer('health');
            }}
          >
            <span>♡</span> Health
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              setDrawer('settings');
            }}
          >
            <span>⚙</span> Settings
          </button>
        </nav>
        <div className="workspace-switcher">
          <label>
            Workspace
            <select value={workspace.id} disabled={Boolean(recordingMeetingId)}
              aria-label={recordingMeetingId ? 'Workspace switching is disabled while recording' : 'Workspace'}
              onChange={(event) => {
                const next = workspaces.find((item) => item.id === event.target.value);
                if (next) void selectWorkspace(next);
              }}
            >
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <small>
            <i /> Local only
          </small>
        </div>
      </aside>

      <main className="chat-main">
        <header className="chat-header">
          <button className="mobile-menu-inline icon-button" aria-label="Open conversations" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <div>
            <strong>{selectedChat?.title || 'New conversation'}</strong>
            <small>{chatCli} · {chatCli==='openrouter'?'hosted · explicit cost policy':'local CLI'}</small>
          </div>
          {recordingMeetingId && (
            <div className="recording-global" role="status">
              <button aria-label="Open active meeting recording" onClick={() => setDrawer('meetings')}>
                ● Recording {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
              </button>
              <button aria-label="Stop and save active meeting recording" onClick={() => void stopMeeting().catch(showError)}>
                Stop
              </button>
            </div>
          )}
          {activityCapture?.policy.enabled&&<div className={`capture-global ${activityCapture.policy.paused||!activityCapture.readiness.available?'paused':'active'}`} role="status"><button aria-label="Open whole-device activity capture controls" onClick={()=>setDrawer('activity')}>{activityCapture.readiness.available&&!activityCapture.policy.paused?'● Capturing':'Ⅱ Activity paused'}</button><button aria-label="Pause whole-device activity capture" disabled={activityCapture.policy.paused} onClick={()=>void updateActivityCapture({paused:true}).catch(showError)}>Pause</button></div>}
          <div className="chat-header-actions" role="group" aria-label="Chat actions">
            {selectedChat&&<button className="knowledge-button" aria-label="Delegate task" onClick={()=>void delegateTask()}>Delegate task</button>}
            <button className="knowledge-button" aria-label="Open knowledge" onClick={() => setDrawer('knowledge')}>
              Knowledge <span>⌘K</span>
            </button>
          </div>
        </header>
        {(error || notice) && (
          <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
            {error || notice}
            <button
              aria-label="Dismiss"
              onClick={() => {
                setError('');
                setNotice('');
              }}
            >
              ×
            </button>
          </div>
        )}
        {selectedChat ? (
          <>
            <section ref={transcriptRef} className="transcript" aria-label="Conversation" aria-live="polite" onScroll={(event)=>{const element=event.currentTarget;transcriptFollowingRef.current=shouldFollowChat(element.scrollHeight,element.scrollTop,element.clientHeight)}}>
              {!selectedChat.messages.length && (
                <div className="empty-chat">
                  <div className="compass">✦</div>
                  <h1>What are we working on?</h1>
                  <p>Ask Waypoint to think, write, research your local knowledge, or organize what matters.</p>
                </div>
              )}
              {chatRuns.filter((run)=>!selectedChat.messages.some((message)=>message.id===String(run.sourceMessageId??''))).map(executionHistory)}
              {selectedChat.messages.map((message) => (
                <Fragment key={message.id}>
                <article className={`chat-message ${message.role}`}>
                  <div className="message-role">{message.role === 'assistant' ? <img className="assistant-mark" src={waypointMark} alt="Waypoint" /> : <span>You</span>}</div>
                  <div className="message-content">
                    {message.role==='assistant'?<ChatMarkdown body={message.body}/>:<p>{message.body}</p>}
                    {attachments.some((item) => item.ownerId === message.id) && (
                      <div className="sent-files">
                        {attachments
                          .filter((item) => item.ownerId === message.id)
                          .map((item) => (
                            <span key={item.id}>
                              ▧ {item.name}
                              <small>stored locally</small>
                            </span>
                          ))}
                      </div>
                    )}
                    {message.role === 'assistant' && (
                      <button className="message-action" onClick={() => void saveMessageToKnowledge(message.id)}>
                        ＋ Save to knowledge
                      </button>
                    )}
                  </div>
                </article>
                {message.role==='user'&&runsForSourceMessage(chatRuns,message.id).map(executionHistory)}
                </Fragment>
              ))}
            </section>
            <div className="composer-dock">
              <form className="composer" onSubmit={(event) => void runChat(event, selectedChat.id)}>
                {queued.length > 0 && (
                  <div className="file-queue" aria-label="Queued attachments">
                    {queued.map((item) => (
                      <span key={item.id}>
                        ▧ <b>{item.name}</b>
                        <small>{Math.ceil(item.bytes / 1024)} KiB</small>
                        <button type="button" aria-label={`Remove ${item.name}`} onClick={() => void removeAttachment(item.id)}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  ref={composerRef}
                  name="prompt"
                  required
                  rows={1}
                  placeholder="Message Waypoint"
                  aria-label="Message Waypoint"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="composer-controls">
                  <div>
                    <button type="button" className="attach" disabled={attachmentBusy} onClick={() => void chooseAttachments()} aria-label="Attach files">
                      ＋
                    </button>
                    <button type="button" className={`voice-control ${voiceState!=='off'||voiceSessionActive?'active':''}`} aria-label={voiceMode==='hands_free'?(voiceSessionActive?'End hands-free voice session':'Start hands-free voice session'):'Hold to talk'} title={voiceMode==='hands_free'?(voiceSessionActive?'End voice session':'Start hands-free voice'):'Hold to talk'} aria-pressed={voiceMode==='hands_free'?voiceSessionActive:undefined} onClick={voiceMode==='hands_free'?()=>void toggleHandsFree():undefined} onPointerDown={voiceMode==='push_to_talk'?(event)=>{event.currentTarget.setPointerCapture(event.pointerId);beginPushToTalk()}:undefined} onPointerUp={voiceMode==='push_to_talk'?releasePushToTalk:undefined} onPointerCancel={voiceMode==='push_to_talk'?()=>void stopVoiceMode():undefined} onKeyDown={voiceMode==='push_to_talk'?(event)=>{if(!event.repeat&&(event.key===' '||event.key==='Enter')){event.preventDefault();beginPushToTalk()}}:undefined} onKeyUp={voiceMode==='push_to_talk'?(event)=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();releasePushToTalk()}}:undefined}><span/><span/><span/></button>
                    <select name="cli" value={chatCli} onChange={(event) => setChatCli(event.target.value as 'codex' | 'claude'|'openrouter')} aria-label="AI provider">
                      {capabilities.map((item) => (
                        <option key={item.name} value={item.name} disabled={!item.available || item.compatible === false}>
                          {item.name}
                          {!item.available ? ' · unavailable' : ''}
                        </option>
                      ))}
                      <option value="openrouter" disabled={!openRouter?.capability.available}>OpenRouter{openRouter?.capability.available?' · hosted cost':` · ${openRouter?.capability.reason??'Open Settings to configure a protected key and activation.'}`}</option>
                    </select>
                    <select name="profile" value={selectedProfileId} onChange={(event)=>setSelectedProfileId(event.target.value)} aria-label="Security profile">
                      {profiles.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <select name="model" aria-label={`${chatCli} model`} value={selectedComposerModel} onChange={(event)=>void changeComposerModel(event.target.value).catch(showError)}>
                      {composerModelChoices.map((model)=><option value={model.id} key={model.id||'default'}>{model.label}</option>)}
                    </select>
                  </div>
                  <div className="composer-status-actions">
                    {voiceState!=='off'&&<div className={`voice-transient ${voiceState}`} role="status" aria-live="polite"><span className="voice-pulse"/><span>{voicePartial||voiceState.replace('_',' ')}</span></div>}
                    <button className="send" aria-label="Send message">↑</button>
                  </div>
                </div>
                <p className="capability-copy">{chatCli==='openrouter'?'Text only · hosted cost · attachments stay local · cancel available.':chatCli === 'codex' ? 'Images and text can be passed to the Codex CLI. PDF and Word stay local.' : 'Text can be passed to Claude. Images, PDF, and Word stay local.'} {chatCli!=='openrouter'&&cliModels.find((item)=>item.provider===chatCli)?.reason}</p>
                <p className="route-copy" role="status">{chatCli==='openrouter'?`${openRouter?.capability.reason??'OpenRouter status unavailable'} Fallback only at cap to the configured available subscription route.`:routeProposal?.selected?`Route: ${routeProposal.selected} · local signed-in CLI · ${routeProposal.fallbackEnabled?'fallback enabled':'no fallback'} · ${routeProposal.securityProfileId}`:'No eligible local route. Check provider health; fallback remains disabled.'}</p>
              </form>
              <small className="composer-hint">Enter to send · Shift Enter for a new line</small>
            </div>
          </>
        ) : (
          <section className="transcript">
            <div className="empty-chat">
              <div className="compass">✦</div>
              <h1>Start with a conversation.</h1>
              <p>Your chats become the path into notes, memories, and everything Waypoint knows.</p>
              <button onClick={() => void beginNewChat()}>New chat</button>
            </div>
          </section>
        )}
      </main>

      {drawer && (
        <>
          <button className="drawer-scrim" aria-label="Close panel" onClick={() => setDrawer(undefined)} />
          <aside ref={overlayRef} className="right-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
            <header>
              <div>
                <p>{workspace.name}</p>
                <h2 id="drawer-title">{drawer[0].toUpperCase() + drawer.slice(1)}</h2>
              </div>
              <button className="icon-button" aria-label="Close panel" onClick={() => setDrawer(undefined)}>
                ×
              </button>
            </header>
            {drawer==='reflection'&&<div className="drawer-body"><p className="drawer-intro">Review selected local sources with an already signed-in CLI. Sources are never overwritten and runs never schedule themselves.</p><section><h3>Sources <span>{reflectionSources.length}/50</span></h3>{[...memories.map((item)=>({id:item.id,title:item.title,kind:'memory'})),...documents.map((item)=>({id:item.id,title:item.title,kind:'document'}))].map((item)=><label className="meeting-consent" key={item.id}><input type="checkbox" checked={reflectionSources.includes(item.id)} onChange={(event)=>setReflectionSources((current)=>event.target.checked?[...current,item.id].slice(0,50):current.filter((id)=>id!==item.id))}/><span><strong>{item.title}</strong><small>{item.kind} · {item.id}</small></span></label>)}<label className="settings-field"><span>Local reflection provider</span><select aria-label="Local reflection provider" value={reflectionProvider} onChange={(event)=>setReflectionProvider(event.target.value as 'codex'|'claude')}><option value="codex">Signed-in Codex CLI</option><option value="claude">Signed-in Claude Code CLI</option></select></label><div className="drawer-actions"><button disabled={!reflectionSources.length||reflectionActive} onClick={()=>void startReflection().catch(showError)}>{reflectionActive?'Reviewing…':'Reflect on selected sources'}</button>{reflectionActive&&<button className="secondary" aria-label="Cancel active reflection" onClick={()=>workspace&&void window.waypoint.cancelReflection(workspace.id)}>Cancel</button>}</div></section><section aria-live="polite"><h3>Run history</h3>{reflectionRuns.map((run)=><button className="secondary" key={run.id} aria-pressed={selectedReflectionRunId===run.id} onClick={()=>void selectReflectionRun(run.id).catch(showError)}>{run.status} · {run.provider} · {new Date(run.createdAt).toLocaleString()}</button>)}{(()=>{const run=reflectionRuns.find((item)=>item.id===selectedReflectionRunId);return run?<article className="knowledge-item"><strong>{run.status}</strong><p>Workspace: {workspace?.name} · {workspace?.id}</p><p>Provider: {run.provider} CLI · {run.providerVersion}</p><p>Policy: {run.policyVersion}</p><p>Budget: {run.budgetJson}</p><p>Omissions: {run.omissionsJson}</p><small>Run {run.id} · {run.createdAt}</small></article>:<p className="drawer-empty">No reflection run yet.</p>})()}</section><section><h3>Proposed revisions <span>{reflectionProposals.length}</span></h3>{reflectionProposals.map((item)=><article className="knowledge-item suggestion-item" key={item.id}><div><small className="suggestion-meta">{item.kind} · {item.status} · {item.sourceIds.split(',').length} sources</small><strong>{item.title}</strong><p>{item.rationale}</p><small>Before</small><p>{item.beforeBody}</p><small>Proposed</small><p>{item.proposedBody||'No winner selected. Edit is required before acceptance.'}</p><small>Sources: {item.sourceIds} · digests {item.sourceDigests}</small></div><div className="knowledge-actions">{item.status==='proposed'&&<><button disabled={!item.proposedBody} onClick={()=>void resolveReflection(item,'accept').catch(showError)}>Accept</button><button onClick={()=>void resolveReflection(item,'edit').catch(showError)}>Edit &amp; accept</button><button onClick={()=>void resolveReflection(item,'reject').catch(showError)}>Reject</button></>}{['accepted','edited'].includes(item.status)&&<button onClick={()=>void resolveReflection(item,'rollback').catch(showError)}>Rollback</button>}</div></article>)}{!reflectionProposals.length&&<p className="drawer-empty">No proposals for this run.</p>}</section></div>}
            {drawer === 'knowledge' && (
              <div className="drawer-body">
                <p className="drawer-intro">Review what Waypoint may remember from conversation. Nothing becomes durable knowledge until you approve it.</p>
                <div className="drawer-actions">
                  <button onClick={() => void scanSuggestions()}>Review conversation</button>
                </div>
                <section>
                  <h3>
                    Suggestions <span>{suggestions.length}</span>
                  </h3>
                  {suggestions.map((item) => (
                    <article className="knowledge-item suggestion-item" key={item.id}>
                      <div>
                        <small className="suggestion-meta">
                          {item.category} · {Math.round(item.confidence * 100)}% · {item.sourceRole}
                        </small>
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                        <small>Source: “{item.sourceExcerpt}”</small>
                      </div>
                      <div className="knowledge-actions">
                        <button onClick={() => void resolveSuggestion(item, 'accept')}>Accept</button>
                        <button onClick={() => void resolveSuggestion(item, 'accept', true)}>Edit &amp; accept</button>
                        <button onClick={() => void resolveSuggestion(item, 'reject')}>Reject</button>
                      </div>
                    </article>
                  ))}
                  {!suggestions.length && <p className="drawer-empty">No pending suggestions. Review the current conversation when you are ready.</p>}
                </section>
                <section>
                  <h3>
                    Commitments <span>{commitments.filter((item) => item.status === 'open').length}</span>
                  </h3>
                  {commitments.map((item) => (
                    <article id={`activity-target-${item.id}`} className={`knowledge-item commitment-item ${item.status} ${activityKnowledgeTarget === item.id ? 'activity-target' : ''}`} key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                        <small>Source: “{item.sourceExcerpt}”</small>
                      </div>
                      <button aria-label={`${item.status === 'open' ? 'Complete' : 'Reopen'} ${item.title}`} onClick={() => void toggleCommitment(item)}>
                        {item.status === 'open' ? 'Complete' : 'Reopen'}
                      </button>
                    </article>
                  ))}
                  {!commitments.length && <p className="drawer-empty">No accepted commitments.</p>}
                </section>
                <section>
                  <h3>
                    Notes <span>{documents.length}</span>
                  </h3>
                  <div className="knowledge-actions"><button disabled={documentImportBusy} onClick={()=>void importDocument()}>Import PDF, Word, or text</button></div>
                  {documents.map((item) => (
                    <article id={`activity-target-${item.id}`} className={`knowledge-item ${activityKnowledgeTarget === item.id ? 'activity-target' : ''}`} key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.body.slice(0, 180)}</p>
                        {documentIndexes[item.id]?.sourceAvailable&&<small>{documentIndexes[item.id].sourceName} · {documentIndexes[item.id].state==='indexed'?`${documentIndexes[item.id].chunkCount} semantic chunks · ${documentIndexes[item.id].model}`:'lexical search ready · local embedding unavailable or not built'}</small>}
                      </div>
                      <div className="knowledge-actions">
                        <button aria-label={`Edit ${item.title}`} onClick={() => void editDocument(item)}>
                          Edit
                        </button>
                        {documentIndexes[item.id]?.sourceAvailable&&<button disabled={documentImportBusy} aria-label={`Reindex ${item.title}`} onClick={()=>void reindexDocument(item.id)}>Reindex</button>}
                        {(documentIndexes[item.id]?.retainedGenerations??0)>1&&<button disabled={documentImportBusy} aria-label={`Roll back index for ${item.title}`} onClick={()=>void rollbackDocumentIndex(item.id)}>Roll back index</button>}
                        <button aria-label={`Delete ${item.title}`} onClick={() => void remove('document', item.id)}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                  {!documents.length && <p className="drawer-empty">No notes yet. Use Save to knowledge on an assistant response.</p>}
                </section>
                <section>
                  <h3>
                    Memories <span>{memories.length}</span>
                  </h3>
                  {memories.map((item) => (
                    <article id={`activity-target-${item.id}`} className={`knowledge-item ${activityKnowledgeTarget === item.id ? 'activity-target' : ''}`} key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.body.slice(0, 180)}</p>
                      </div>
                      <button aria-label={`Delete ${item.title}`} onClick={() => void remove('memory', item.id)}>
                        Delete
                      </button>
                    </article>
                  ))}
                  {!memories.length && <p className="drawer-empty">No memories yet.</p>}
                </section>
              </div>
            )}
            {drawer === 'rules' && (
              <div className="drawer-body">
                <p className="drawer-intro">Review workspace relationships and repeated directives. Rules remain advisory and cannot change tools, providers, security, schedules, sync, or external systems.</p>
                <div className="drawer-actions">
                  <button onClick={() => void scanRules()}>Scan repeated directives</button>
                </div>
                <section>
                  <h3>
                    Rule suggestions <span>{ruleSuggestions.length}</span>
                  </h3>
                  {ruleSuggestions.map((item) => (
                    <article className="knowledge-item suggestion-item" key={item.id}>
                      <div>
                        <small className="suggestion-meta">
                          {item.scope} · v{item.extractorVersion} · {item.sources.length} sources
                        </small>
                        <strong>{item.statement}</strong>
                        {item.sources.map((source) => (
                          <small key={source.messageId}>
                            “{source.excerpt}” · {source.messageId.slice(0, 10)}…
                          </small>
                        ))}
                      </div>
                      <div className="knowledge-actions">
                        <button onClick={() => void dryRunRule(item)}>Dry run</button>
                        <button disabled={!item.lastDryRunAt} onClick={() => void resolveRule(item, 'approve')}>
                          Approve
                        </button>
                        <button onClick={() => void resolveRule(item, 'reject')}>Reject</button>
                      </div>
                    </article>
                  ))}
                  {!ruleSuggestions.length && <p className="drawer-empty">No repeated user directives are waiting for review.</p>}
                </section>
                <section>
                  <h3>
                    Advisory rules <span>{learnedRules.length}</span>
                  </h3>
                  {learnedRules.map((item) => (
                    <article className={`knowledge-item rule-item ${item.enabled ? 'enabled' : 'disabled'}`} key={item.id}>
                      <div>
                        <small className="suggestion-meta">
                          workspace · v{item.version} · {item.enabled ? 'enabled' : 'disabled'}
                        </small>
                        <strong>{item.statement}</strong>
                        <small>{item.outcomes.map((outcome) => `${outcome.action} (${outcome.matchCount})`).join(' · ')}</small>
                      </div>
                      <div className="knowledge-actions">
                        <button onClick={() => void toggleRule(item)}>{item.enabled ? 'Disable' : 'Enable'}</button>
                        <button disabled={item.priorEnabled === null} onClick={() => void revertRule(item)}>
                          Revert
                        </button>
                      </div>
                    </article>
                  ))}
                  {!learnedRules.length && <p className="drawer-empty">No approved advisory rules.</p>}
                </section>
                <section>
                  <h3>
                    Knowledge graph <span>{knowledgeGraph.nodes.length}</span>
                  </h3>
                  {knowledgeGraph.nodes.map((node) => (
                    <button
                      className="graph-node"
                      key={node.id}
                      onClick={() => {
                        if (node.kind === 'chat') setSelectedChatId(node.id);
                        setDrawer(node.kind === 'chat' ? undefined : 'knowledge');
                      }}
                    >
                      <span>{node.kind}</span>
                      <strong>{node.title}</strong>
                      <small>
                        {knowledgeGraph.edges
                          .filter((edge) => edge.fromId === node.id || edge.toId === node.id)
                          .map((edge) => `${edge.fromId === node.id ? '→' : '←'} ${edge.type}`)
                          .join(' · ') || 'No visible relationships'}
                      </small>
                    </button>
                  ))}
                  {!knowledgeGraph.nodes.length && <p className="drawer-empty">Relationships appear after knowledge is saved from conversation.</p>}
                </section>
              </div>
            )}
            {drawer === 'briefing' && briefing && (
              <div className="drawer-body">
                <p className="drawer-intro">
                  A bounded local review for {briefing.localDay} in {briefing.timezone}. Generated{' '}
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: briefing.timezone,
                  }).format(new Date(briefing.generatedAt))}
                  . External accounts were not checked.
                </p>
                <div className="drawer-actions">
                  <button onClick={() => void openBriefing()}>Refresh briefing</button>
                </div>
                <section>
                  <h3>
                    For review <span>{briefing.items.length}</span>
                  </h3>
                  {briefing.items.map((item) => (
                    <article className="knowledge-item briefing-item" key={`${item.kind}:${item.id}`}>
                      <div>
                        <small className="suggestion-meta">
                          {item.kind} · {item.freshness} · {item.id.slice(0, 12)}…
                        </small>
                        <strong>{item.title}</strong>
                        <p>
                          {item.missingSource ? (
                            'Source content is unavailable.'
                          ) : (
                            <>
                              {item.detail.slice(0, 240)}
                              {item.detail.length > 240 || item.detailTruncated ? '…' : ''}
                            </>
                          )}
                        </p>
                        <small>
                          {item.whyIncluded} · source excerpt · updated{' '}
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                            timeZone: briefing.timezone,
                          }).format(new Date(item.updatedAt))}
                        </small>
                      </div>
                      <button aria-label={`Dismiss ${item.title} for ${briefing.localDay}`} onClick={() => void dismissBriefing(item)}>
                        Dismiss today
                      </button>
                    </article>
                  ))}
                  {!briefing.items.length && <p className="drawer-empty">Nothing local is waiting for review today.</p>}
                </section>
                <section>
                  <h3>Coverage</h3>
                  <p className="drawer-intro">
                    {briefing.coverage.openCommitments} open commitments · {briefing.coverage.documents} notes · {briefing.coverage.memories} memories · {briefing.coverage.dismissed} dismissed today · {briefing.coverage.missingSources} missing sources · {briefing.coverage.omittedByLimit} omitted by limit
                  </p>
                  {briefing.omissions.map((item) => (
                    <p className="briefing-omission" key={item}>
                      {item}
                    </p>
                  ))}
                </section>
              </div>
            )}
            {drawer === 'meetings' && (
              <div className="drawer-body">
                <p className="drawer-intro">Audio-only recording stays on this Mac and is never synced or uploaded. Confirm that everyone has consented and that recording is legal where you are. Recordings remain until you explicitly delete them.</p>
                <label className="meeting-consent">
                  <input type="checkbox" checked={meetingConsent} disabled={Boolean(recordingMeetingId)} onChange={(event) => setMeetingConsent(event.target.checked)} /> I have informed participants and confirmed consent for this recording session.
                </label>
                {recordingMeetingId ? (
                  <div className="recording-state" role="status" aria-live="assertive">
                    <i /> Recording · {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
                    <button onClick={() => void stopMeeting().catch(showError)}>Stop &amp; save locally</button>
                  </div>
                ) : (
                  <div className="drawer-actions">
                    <button disabled={!meetingConsent} onClick={() => void startMeeting().catch(showError)}>
                      Start audio recording
                    </button>
                  </div>
                )}
                <p className="transcription-note">{transcriptionCapability?.reason}</p>
                <section>
                  <h3>
                    Local recordings <span>{meetings.length}</span>
                  </h3>
                  {meetings.map((item) => (
                    <article className="meeting-item" key={item.id}>
                      <header>
                        <div>
                          <strong>{item.title}</strong>
                          <small>
                            {item.status} · {item.bytes ? `${(item.bytes / 1024 / 1024).toFixed(1)} MiB` : 'no saved audio'} · speakers uncertain
                          </small>
                        </div>
                        <button onClick={() => void removeMeeting(item.id).catch(showError)}>Delete</button>
                      </header>
                      {item.status === 'ready' && (
                        <>
                          <div className="meeting-actions">
                            <button onClick={() => void playMeeting(item.id).catch(showError)}>Play</button>
                            <button onClick={() => void window.waypoint.exportMeetingAudio(workspace.id, item.id).catch(showError)}>Export audio</button>
                            {meetingTranscriptionRun?.meetingId===item.id?<button onClick={()=>void cancelMeetingTranscription().catch(showError)}>Cancel transcription ({meetingTranscriptionRun.completed} segments)</button>:<button disabled={!transcriptionCapability?.available||Boolean(meetingTranscriptionRun)} onClick={()=>void transcribeMeeting(item.id)}>Transcribe locally</button>}
                          </div>
                          <textarea
                            aria-label={`Transcript draft for ${item.title}`}
                            placeholder="Enter or paste a local transcript draft. Mark uncertain speakers like “Speaker 1?”."
                            value={transcriptDrafts[item.id] ?? ''}
                            onChange={(event) =>
                              setTranscriptDrafts((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          />
                          <div className="meeting-actions">
                            <button onClick={() => void saveTranscript(item.id, false).catch(showError)}>Save draft</button>
                            <button onClick={() => void saveTranscript(item.id, true).catch(showError)}>Mark reviewed</button>
                            <button disabled={item.transcriptStatus !== 'reviewed'} onClick={() => void saveMeetingMemory(item.id).catch(showError)}>
                              Save to knowledge
                            </button>
                          </div>
                        </>
                      )}
                      {item.status === 'failed' && <p>Capture ended without a retained audio artifact ({item.failureCode?.replaceAll('_', ' ')}). Delete this record when no longer useful.</p>}
                    </article>
                  ))}
                  {!meetings.length && <p className="drawer-empty">No local meeting recordings.</p>}
                </section>
              </div>
            )}
            {drawer === 'activity' && (
              <div className="drawer-body">
                <section className="capture-console" aria-label="Whole-device activity capture">
                  <header><div><strong>Whole-device history</strong><small role="status">{!activityCapture?'Checking…':!activityCapture.policy.enabled?'Off':activityCapture.policy.paused||!activityCapture.readiness.available?'Paused':'Capturing periodic snapshots'}</small></div><span className={activityCapture?.policy.enabled&&!activityCapture.policy.paused&&activityCapture.readiness.available?'active':'paused'} /></header>
                  <p>Opt-in periodic screenshots, never video. Pause is immediate and never backfills. No cloud capture or raw OCR is placed in receipts.</p>
                  {activityCapture&&<><div className="capture-readiness"><strong>{activityCapture.readiness.available?'Native capture ready':'Native capture unavailable'}</strong><span>{activityCapture.readiness.reason}</span></div><label>Raw snapshot retention<select aria-label="Raw snapshot retention" value={activityCapture.policy.retentionDays} onChange={(event)=>void updateActivityCapture({retentionDays:Number(event.target.value) as 90|183|365}).catch(showError)}><option value="90">90 days</option><option value="183">6 months</option><option value="365">1 year</option></select></label><label>Excluded app bundle IDs or process names<textarea aria-label="Excluded apps, one per line" value={activityExclusions} onChange={(event)=>setActivityExclusions(event.target.value)} onBlur={()=>void updateActivityCapture({exclusions:activityExclusions.split('\n').map((item)=>item.trim()).filter(Boolean)}).catch(showError)} placeholder="com.example.private-app" /></label><label className="capture-check"><input type="checkbox" checked={activityCapture.policy.syncRaw} onChange={(event)=>void updateActivityCapture({syncRaw:event.target.checked}).catch(showError)} />Encrypted raw snapshot sync and backup (can use substantial storage/bandwidth)</label><div className="drawer-actions"><button disabled={!activityCapture.readiness.available} onClick={()=>void updateActivityCapture({enabled:true,paused:false}).catch(showError)}>Preview &amp; resume</button><button className="secondary" disabled={!activityCapture.policy.enabled||activityCapture.policy.paused} onClick={()=>void updateActivityCapture({paused:true}).catch(showError)}>Pause now</button><button className="secondary" disabled={!activityCapture.policy.enabled} onClick={()=>void updateActivityCapture({enabled:false,paused:true}).catch(showError)}>Stop</button></div><small>{activityCapture.storage.count} snapshots · {(activityCapture.storage.bytes/1024/1024).toFixed(1)} MB local raw storage</small></>}
                  <div className="activity-filters"><input aria-label="Search captured app timeline" placeholder="Search app, process, or device" value={activitySnapshotQuery} onChange={(event)=>setActivitySnapshotQuery(event.target.value)} /><button disabled={!activitySnapshots.length} onClick={()=>void removeAllActivitySnapshots().catch(showError)}>Delete all raw</button></div>
                  {activitySnapshots.map((item)=><article className="capture-item" key={item.id}><div><strong>{item.appTitle||item.appProcess}</strong><small>{item.appBundleId} · {item.deviceId} / {item.displayId}</small><small>Captured {new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.capturedAt))} · expires {new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(item.expiresAt))} · {(item.bytes/1024).toFixed(1)} KB{item.synced?' · encrypted sync queued/retained':' · local only'}</small></div><div><button aria-label={`View snapshot from ${item.appTitle||item.appProcess}`} onClick={()=>void previewActivitySnapshot(item.id).catch(showError)}>View</button><button aria-label={`Delete snapshot from ${item.appTitle||item.appProcess}`} onClick={()=>void removeActivitySnapshot(item.id).catch(showError)}>Delete</button></div>{activityPreview?.id===item.id&&<figure className="capture-preview"><img src={activityPreview.url} alt={`Private snapshot from ${item.appTitle||item.appProcess} at ${item.capturedAt}`} /><button onClick={()=>setActivityPreview(undefined)}>Close preview</button></figure>}</article>)}
                  {!activitySnapshots.length&&<p className="drawer-empty">No raw activity snapshots. Waypoint has not captured this screen.</p>}
                </section>
                <p className="drawer-intro">A workspace-scoped history of meaningful local actions. Event details never copy prompts, documents, transcripts, file paths, or credentials.</p>
                <div className="activity-filters">
                  <input value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Filter activity" aria-label="Filter activity" />
                  <select value={activityFamilyFilter} onChange={(event) => setActivityFamilyFilter(event.target.value as ActivityFamily | 'all')} aria-label="Activity family">
                    <option value="all">All activity</option>
                    <option value="content">Content</option>
                    <option value="execution">AI execution</option>
                    <option value="sync">Sync &amp; devices</option>
                    <option value="rules">Rules</option>
                    <option value="automation">Automations</option>
                    <option value="meeting">Meetings</option>
                    <option value="lifecycle">Deletion</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
                {activity
                  .filter((item) => (activityFamilyFilter === 'all' || item.family === activityFamilyFilter) && (!activityQuery.trim() || [item.action, item.family, item.objectKind, item.objectTitle ?? ''].some((value) => value.toLocaleLowerCase().includes(activityQuery.trim().toLocaleLowerCase()))))
                  .map((item) => (
                    <article className={`activity-item ${item.family} ${item.objectState}`} key={item.id}>
                      <span />
                      <div>
                        <small className="activity-family">
                          {item.family} · {item.objectState}
                        </small>
                        <strong>{item.action.replaceAll('.', ' ')}</strong>
                        {Object.keys(item.details).length > 0 && (
                          <small>
                            {Object.entries(item.details)
                              .map(([key, value]) => `${key}: ${String(value)}`)
                              .join(' · ')}
                          </small>
                        )}
                        {item.objectTitle && (
                          <button onClick={() => followActivity(item)} disabled={item.objectState !== 'available' || !item.targetId}>
                            {item.objectTitle}
                          </button>
                        )}
                        <small>
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(item.createdAt))}
                        </small>
                      </div>
                    </article>
                  ))}
                {!activity.filter((item) => (activityFamilyFilter === 'all' || item.family === activityFamilyFilter) && (!activityQuery.trim() || [item.action, item.family, item.objectKind, item.objectTitle ?? ''].some((value) => value.toLocaleLowerCase().includes(activityQuery.trim().toLocaleLowerCase())))).length && <p className="drawer-empty">No activity matches this filter. Meeting and automation events appear only after those features are explicitly enabled.</p>}
              </div>
            )}
            {drawer === 'health' && (
              <div className="drawer-body">
                <div className="drawer-actions">
                  <button onClick={() => void runHealth()} disabled={checking}>
                    {checking ? 'Checking…' : 'Run local checks'}
                  </button>
                </div>
                {diagnostics?.results.map((item) => (
                  <article className={`health-item ${item.status}`} key={item.code}>
                    <span>{item.status.replace('_', ' ')}</span>
                    <strong>{item.code}</strong>
                    <p>{item.summary}</p>
                    {item.remediation && <small>{item.remediation}</small>}
                  </article>
                )) || <p className="drawer-empty">Check the database, storage, attachments, indexes, CLIs, and local sync state.</p>}
              </div>
            )}
            {drawer === 'settings' && (
              <div className="drawer-body">
                <section>
                  <h3>AI Tool Gateway</h3>
                  <p className="drawer-intro">Trusted local commands use the Autonomous Developer profile. This is powerful local authority, not an OS security sandbox: receipts are bounded and redacted, but commands can use your installed tools and local identity. Agent Browser Preview is limited to isolated, user-approved public domains and non-secret navigation actions; PR and deployment tools are not exposed.</p>
                  {toolSettings&&<><div className="automation-boundary" role="status"><strong>{toolSettings.stopped?'Stopped':'Ready · local only'}</strong><span>environment inherited · receipts redacted · trusted-workspace guardrails</span></div><div className={`automation-boundary ${toolCapabilities?.browser.available?'':'warning'}`} role="status"><strong>Agent Browser · {toolCapabilities?.browser.available?'runtime verified':'unavailable'}</strong><span>{toolCapabilities?.browser.reason??'Checking security readiness…'}</span></div><label className="settings-field">Browser profile<select aria-label="Agent Browser profile mode" value={toolSettings.browserProfileMode} onChange={(event)=>void saveToolGateway({browserProfileMode:event.target.value as 'existing'|'isolated'}).catch(showError)}><option value="isolated">Isolated Waypoint session</option><option value="existing" disabled>Existing signed-in profile · containment repair required</option></select></label><label className="meeting-consent">Allowed public browser domains (one hostname per line)<textarea aria-label="Allowed browser domains" value={toolSettings.browserAllowedDomains.join('\n')} onChange={(event)=>setToolSettings({...toolSettings,browserAllowedDomains:event.target.value.split('\n').map((item)=>item.trim()).filter(Boolean)})} rows={3}/></label><label className="meeting-consent">Deny patterns (one regular expression per line)<textarea value={denyDraft} onChange={(event)=>setDenyDraft(event.target.value)} rows={4}/></label><label className="meeting-consent"><input type="checkbox" checked={toolSettings.suppressCommit} onChange={(event)=>void saveToolGateway({suppressCommit:event.target.checked}).catch(showError)}/>Suppress Git commit for this workspace</label><label className="meeting-consent"><input type="checkbox" checked={toolSettings.suppressPush} onChange={(event)=>void saveToolGateway({suppressPush:event.target.checked}).catch(showError)}/>Suppress Git push for this workspace</label><div className="drawer-actions"><button onClick={()=>void saveToolGateway().catch(showError)}>Save policy</button><button className="secondary" onClick={()=>void saveToolGateway({stopped:!toolSettings.stopped}).catch(showError)}>{toolSettings.stopped?'Resume gateway':'Stop all tools'}</button><button className="secondary" onClick={()=>workspace&&void window.waypoint.clearToolGatewayBrowserData(workspace.id).catch(showError)}>Clear isolated browser data</button></div></>}
                  {toolCapabilities&&<dl className="settings-list">{toolCapabilities.localClis.map((item)=><div key={item.name}><dt>{item.name}</dt><dd>{item.available?'installed · local identity':'unavailable'}</dd></div>)}</dl>}
                  {toolSettings&&toolCapabilities&&<div className="settings-panel"><h4>Web Search & Fetch</h4><div className="automation-boundary" role="status"><strong>Explicit external access</strong><span>{toolCapabilities.web.reason}</span></div><label className="meeting-consent"><input type="checkbox" checked={toolSettings.webFetchEnabled} onChange={(event)=>void updateWebTools({webFetchEnabled:event.target.checked,webSearchEnabled:toolSettings.webSearchEnabled}).catch(showError)}/>Allow bounded HTTPS page fetches for this workspace</label><label className="meeting-consent">Brave Search API key<input type="password" autoComplete="off" aria-label="Brave Search API key" value={webSearchKey} placeholder={toolCapabilities.web.searchKeyConfigured?'Protected key stored':'Required for web search'} onChange={(event)=>setWebSearchKeyDraft(event.target.value)}/></label><div className="drawer-actions"><button disabled={!webSearchKey} onClick={()=>void window.waypoint.setWebSearchKey(webSearchKey).then(()=>{setWebSearchKeyDraft('');return loadToolGateway()}).catch(showError)}>Store protected search key</button>{toolCapabilities.web.searchKeyConfigured&&<button className="secondary" onClick={()=>void window.waypoint.removeWebSearchKey().then(loadToolGateway).catch(showError)}>Remove search key</button>}</div><label className="meeting-consent"><input type="checkbox" checked={toolSettings.webSearchEnabled} disabled={!toolCapabilities.web.searchKeyConfigured} onChange={(event)=>void updateWebTools({webFetchEnabled:toolSettings.webFetchEnabled,webSearchEnabled:event.target.checked}).catch(showError)}/>Allow Brave web search for this workspace</label><small>Fetched pages and snippets are labeled untrusted data. Waypoint blocks localhost, private networks, credentials, non-HTTPS URLs, unsafe redirects, and oversized responses.</small></div>}
                  {rollupSettings&&<div className="settings-panel"><h4>Personal cross-workspace roll-ups</h4><p className="settings-copy">This workspace can see only summary families you explicitly grant. Chat text, document and attachment bodies, credentials, and secrets never cross this boundary.</p><label className="meeting-consent"><input type="checkbox" checked={rollupSettings.standingEnabled} onChange={(event)=>setRollupSettings({...rollupSettings,standingEnabled:event.target.checked})}/>Allow standing roll-up requests in this Personal workspace</label>{rollupSettings.availableSources.map((source)=><fieldset key={source.id}><legend>{source.name}</legend>{(['commitments','meetings','briefing_status']as const).map((family)=>{const grant=rollupSettings.grants.find((item)=>item.sourceWorkspaceId===source.id&&item.family===family);return<label className="meeting-consent" key={family}><input type="checkbox" checked={grant?.enabled??false} onChange={(event)=>{const others=rollupSettings.grants.filter((item)=>!(item.sourceWorkspaceId===source.id&&item.family===family)),next={sourceWorkspaceId:source.id,sourceWorkspaceName:source.name,family,enabled:event.target.checked,createdAt:grant?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString()};setRollupSettings({...rollupSettings,grants:[...others,next]})}}/>{family==='briefing_status'?'Briefing/status counts':family[0].toUpperCase()+family.slice(1)}</label>})}</fieldset>)}<div className="drawer-actions"><button onClick={()=>void saveRollups(rollupSettings).catch(showError)}>Save sharing grants</button><button className="secondary" onClick={()=>workspace&&void window.waypoint.composeCrossWorkspaceRollup(workspace.id).then(setRollupPreview).catch(showError)}>Preview roll-up</button></div>{rollupPreview&&<div className="automation-boundary" role="status"><strong>{rollupPreview.items.length} summary item{rollupPreview.items.length===1?'':'s'}</strong><span>{rollupPreview.provenance}</span></div>}</div>}
                  <div className="activity-list">{toolReceipts.slice(0,10).map((item)=><article className="activity-item execution" key={item.id}><span/><div><strong>{item.tool} · {item.status}</strong><small>{item.summary}</small><small>{new Date(item.startedAt).toLocaleString()} · {item.origin} · {item.outputBytes} bytes{item.truncated?' · truncated':''}</small></div></article>)}</div>
                  <h4>Failure prevention</h4>
                  <p className="settings-copy">Equivalent active failures pause before retry. A changed tool/context or an explicit reason allows a truthful retry; success supersedes the warning.</p>
                  <div className="activity-list">{toolFailures.length?toolFailures.slice(0,20).map((item)=><article className="activity-item execution" key={item.id}><span/><div><strong>{item.tool} · {item.outcome}</strong><small>{item.errorClass}{item.remediation?` · remedy: ${item.remediation}`:''}</small><small>{item.outcome==='active'?`Expires ${new Date(item.expiresAt).toLocaleString()}`:`Superseded ${new Date(item.updatedAt).toLocaleString()}`}{item.hadOverride?' · reasoned retry':''}</small></div><button className="quiet-button" onClick={()=>void window.waypoint.deleteToolFailure(workspace!.id,item.id).then(loadToolGateway).catch(showError)}>Delete</button></article>):<p className="empty-copy">No learned tool failures in this workspace.</p>}</div>
                </section>
                <section>
                  <h3>Voice chat</h3>
                  <p className="drawer-intro">Local voice engines share the same composer control and privacy boundary. Microphone audio is ephemeral and never enters chat, backup, sync, or activity.</p>
                  <div className={`automation-boundary ${voiceCapability?.stt.available?'':'warning'}`} role="status"><strong>{voiceCapability?.stt.available?'Ready · offline':'Unavailable'}</strong><span>{voiceCapability?.stt.reason??'Checking bundled local speech…'}</span></div>
                  <label className="settings-field">Voice engine<select aria-label="Voice engine" value={voiceEngine} disabled={voiceState!=='off'} onChange={(event)=>void saveVoicePreferences(voiceMode,voiceDevice,event.target.value as 'fast_local'|'full_duplex_experimental').catch(showError)}>{voiceEngineStatus?.engines.map((engine)=><option key={engine.id} value={engine.id} disabled={!engine.ready}>{engine.label}{engine.ready?'':' · not ready'}</option>)??<option value="fast_local">Fast Local</option>}</select></label>
                  {voiceEngineStatus?.engines.map((engine)=><div className={`automation-boundary ${engine.ready?'':'warning'}`} role="status" key={engine.id}><strong>{engine.label} · {engine.ready?'ready':'unavailable'}</strong><span>{engine.reason}</span><small>{engine.conversationOwner==='waypoint-providers'?'Uses the selected Waypoint Codex, Claude, or OpenRouter text route.':'Owns its experimental local conversation; Waypoint provider tools are not available.'}{engine.packageBytes?` · ${(engine.packageBytes/1024/1024).toFixed(1)} MB verified closure`:''}</small><small>{engine.metrics.fixture?'Fixture diagnostics · ':'Measured diagnostics · '}First audio {engine.metrics.firstAudioMs==null?'not measured':`${engine.metrics.firstAudioMs} ms`} · interruption {engine.metrics.interruptionMs==null?'not measured':`${engine.metrics.interruptionMs} ms`} · turn end {engine.metrics.turnEndMs==null?'not measured':`${engine.metrics.turnEndMs} ms`}</small>{engine.id==='full_duplex_experimental'&&!engine.ready&&<><progress aria-label="Experimental voice pack installation progress" value={0} max={100}/><small>Managed pack status: not installed. Exact download size, hardware requirement, license, and first-run cost will be read from a signed production manifest before one-click consent. Resume, integrity verification, atomic activation, rollback, and removal are implemented and fixture-tested; no pack URL is approved in this build.</small><button type="button" className="secondary" disabled aria-label="Install Experimental Full-Duplex voice pack unavailable">Install voice pack · unavailable until manifest approval</button></>}</div>)}
                  <label className="settings-field">Default interaction<select aria-label="Default voice mode" value={voiceMode} disabled={voiceState!=='off'} onChange={(event)=>void saveVoicePreferences(event.target.value as VoiceMode,voiceDevice).catch(showError)}><option value="push_to_talk">Push to talk · hold composer control</option><option value="hands_free">Hands-free · click to enter or exit</option></select></label>
                  <label className="settings-field">Microphone<select aria-label="Voice microphone" value={voiceDevice} disabled={voiceState!=='off'} onChange={(event)=>void saveVoicePreferences(voiceMode,event.target.value).catch(showError)}><option value="">System default</option>{voiceDevices.map((device,index)=><option value={device.deviceId} key={device.deviceId||index}>{device.label||`Microphone ${index+1}`}</option>)}</select></label>
                  <label className="settings-field">Reply voice<select aria-label="Voice output" value="system" disabled><option value="system">Bundled Fast Local voice</option></select></label>
                  <p className="settings-help">Hands-free uses local speech/silence detection to end each turn, then resumes after the spoken response. Use headphones to reduce echo. This is not full duplex.</p>
                  <div className="drawer-actions"><button className="secondary" onClick={()=>void loadVoiceCapability().catch(showError)}>Refresh voice diagnostics</button>{voiceState!=='off'&&<button onClick={()=>void stopVoiceMode()}>Stop voice now</button>}</div>
                </section>
                <section>
                  <h3>OpenRouter & hosted models</h3>
                  <p className="drawer-intro">Optional hosted routing. Codex and Claude subscriptions remain the primary local CLI lanes. Kimi K3 and DeepSeek V4 Flash are roles until exact model IDs are configured and verified.</p>
                  {openRouter&&<><div className={`automation-boundary ${openRouter.usage.summary.capReached?'warning':''}`} role="status"><strong>{openRouter.capability.state.replaceAll('_',' ')}</strong><span>{openRouter.capability.reason} · health {openRouter.capability.health.replaceAll('_',' ')}</span></div>
                  <div className="provider-cost-grid"><article><small>This month</small><strong>${(openRouter.usage.summary.monthMicros/1_000_000).toFixed(2)}</strong><span>projected ${(openRouter.usage.summary.projectedMonthMicros/1_000_000).toFixed(2)}</span></article><article><small>Year to date</small><strong>${(openRouter.usage.summary.ytdMicros/1_000_000).toFixed(2)}</strong><span>{openRouter.usage.summary.capReached?'cap reached':openRouter.usage.summary.warning?'warning threshold':'within configured budget'}</span></article></div>
                  <label className="meeting-consent">API key <input type="password" autoComplete="off" placeholder={openRouter.keyConfigured?'Protected key stored':'Enter key to protected storage'} value={openRouterKey} onChange={(event)=>setOpenRouterKeyDraft(event.target.value)}/></label><div className="drawer-actions"><button disabled={!openRouterKey} onClick={()=>void storeOpenRouterKey().catch(showError)}>Store protected key</button>{openRouter.keyConfigured&&<button className="secondary" onClick={()=>void window.waypoint.removeOpenRouterKey().then(refreshOpenRouter).catch(showError)}>Remove key</button>}</div>
                  <label className="meeting-consent"><input type="checkbox" checked={openRouter.settings.enabled&&openRouter.settings.liveRequestsEnabled} disabled={!openRouter.keyConfigured} onChange={()=>void toggleOpenRouterActivation().catch(showError)}/>Enable hosted OpenRouter requests when explicitly selected (may incur cost; no background health call)</label>
                  <label>Codex model<select aria-label="Codex model preference" value={chatModels.codex} onChange={(event)=>workspace&&void window.waypoint.setChatModelPreference(workspace.id,'codex',event.target.value).then(setChatModels).catch(showError)}>{codexModelChoices.map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                  <label>Claude model<select aria-label="Claude model preference" value={chatModels.claude} onChange={(event)=>workspace&&void window.waypoint.setChatModelPreference(workspace.id,'claude',event.target.value).then(setChatModels).catch(showError)}>{claudeModelChoices.map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                  <p className="settings-help">These workspace preferences are shared with the chat composer on this device. They remain device-local because installed CLI model catalogs can differ by machine.</p>
                  <label className="settings-field">Strategic model <select aria-label="OpenRouter strategic model" value={openRouter.settings.strategicModel} onChange={(event)=>setOpenRouter({...openRouter,settings:{...openRouter.settings,strategicModel:event.target.value}})}><option value="">Choose a model…</option>{openRouterModelChoices(openRouter.settings.strategicModel).map((model)=><option value={model.id} key={model.id}>{model.name} — {model.id}{'pricing'in model&&model.pricing?` · ${model.pricing}`:''}{model.legacy?' (saved legacy/custom)':''}</option>)}</select></label><label className="settings-field">Everyday model <select aria-label="OpenRouter everyday model" value={openRouter.settings.everydayModel} onChange={(event)=>setOpenRouter({...openRouter,settings:{...openRouter.settings,everydayModel:event.target.value}})}><option value="">Choose a model…</option>{openRouterModelChoices(openRouter.settings.everydayModel).map((model)=><option value={model.id} key={model.id}>{model.name} — {model.id}{'pricing'in model&&model.pricing?` · ${model.pricing}`:''}{model.legacy?' (saved legacy/custom)':''}</option>)}</select></label>
                  <div className="settings-grid"><label>Monthly cap (USD)<input type="number" min="0" step="1" value={openRouter.settings.monthlyCapMicros/1_000_000} onChange={(event)=>setOpenRouter({...openRouter,settings:{...openRouter.settings,monthlyCapMicros:Math.round(Number(event.target.value)*1_000_000)}})}/></label><label>YTD cap (USD)<input type="number" min="0" step="1" value={openRouter.settings.ytdCapMicros/1_000_000} onChange={(event)=>setOpenRouter({...openRouter,settings:{...openRouter.settings,ytdCapMicros:Math.round(Number(event.target.value)*1_000_000)}})}/></label><label>Warn at %<input type="number" min="1" max="100" value={openRouter.settings.warningPercent} onChange={(event)=>setOpenRouter({...openRouter,settings:{...openRouter.settings,warningPercent:Number(event.target.value)}})}/></label><label>Cap fallback<select value={openRouter.settings.fallbackProvider??'codex'} onChange={(event)=>setOpenRouter({...openRouter,settings:{...openRouter.settings,fallbackProvider:event.target.value as 'codex'|'claude'}})}><option value="codex">Codex subscription</option><option value="claude">Claude subscription</option></select></label></div>
                  <div className="drawer-actions"><button onClick={()=>void saveOpenRouterSettings().catch(showError)}>Save provider settings</button></div>
                  <h4>Cost breakdown</h4><div className="activity-list">{openRouter.usage.summary.byModel.length?openRouter.usage.summary.byModel.map((item)=><article className="provider-row" key={item.model}><strong>{item.model}</strong><span>${(item.costMicros/1_000_000).toFixed(4)}</span></article>):<p className="empty-copy">No hosted usage receipts. Setup and status checks make no provider call.</p>}</div></>}
                </section>
                <section>
                  <h3>Secure device sync</h3>
                  <p className="drawer-intro">End-to-end encrypted directly through a desktop host or through the optional Waypoint relay. Keys stay in protected storage on each device.</p>
                  <dl className="settings-list">
                    <div>
                      <dt>Transport</dt>
                      <dd>{desktopSync?.configured?desktopSync.transportMode==='desktop-host'?(desktopSync.peerHost?.running?'Desktop host running':'Desktop host offline'):'Optional hosted relay':desktopSync?.pendingEnrollment?'Approval pending':'Not configured'}</dd>
                    </div>
                    <div>
                      <dt>Key epoch</dt>
                      <dd>{desktopSync?.keyEpoch || '—'}</dd>
                    </div>
                    <div>
                      <dt>Pending changes</dt>
                      <dd>{syncStatus?.pending ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Deletion markers</dt>
                      <dd>{syncStatus?.tombstones ?? 0}</dd>
                    </div>
                  </dl>
                  {!desktopSync?.configured && !desktopSync?.pendingEnrollment && (
                    <div className="drawer-actions">
                      <button onClick={() => void initializeSync()}>Set up first device</button>
                      <button className="secondary" onClick={() => void joinSync()}>
                        Join with invitation
                      </button>
                    </div>
                  )}
                  {desktopSync?.pendingEnrollment && <button onClick={() => void completeSync()}>Complete approved enrollment</button>}
                  {bootstrapBundle && (
                    <div className="bootstrap-bundle">
                      <p>Public operator bootstrap bundle</p>
                      <textarea readOnly value={bootstrapBundle} />
                      <button className="secondary" onClick={() => void navigator.clipboard.writeText(bootstrapBundle)}>
                        Copy public bundle
                      </button>
                    </div>
                  )}
                  {desktopSync?.configured && (
                    <>
                      <div className="drawer-actions">
                        {desktopSync.peerHost?.running?<button className="secondary" onClick={()=>workspace&&void window.waypoint.stopDesktopSyncHost(workspace.id).then(()=>refresh()).catch(showError)}>Stop desktop host</button>:<button onClick={()=>workspace&&void window.waypoint.startDesktopSyncHost(workspace.id).then(()=>refresh()).catch(showError)}>Host on this device</button>}
                        <button onClick={() => void invitePeer()}>Invite device</button>
                        {desktopSync.rotationTargetEpoch && (
                          <button
                            className="secondary"
                            onClick={() =>
                              workspace &&
                              void window.waypoint
                                .resumeSyncRotation(workspace.id)
                                .then(() => refresh())
                                .catch(showError)
                            }
                          >
                            Resume rotation
                          </button>
                        )}
                      </div>
                      <p className="settings-help">{desktopSync.peerHost?.reason??'Desktop hosting is stopped. The hosted relay remains optional for public webhooks, all-peers-offline delivery, and remote reachability.'}</p>
                      {desktopSync.peerHost?.running&&<p className="settings-help">Endpoint {desktopSync.peerHost.endpoint} · certificate {desktopSync.peerHost.fingerprintSha256?.slice(0,16)}…</p>}
                      {pendingPeers.map((item) => (
                        <article className="provider-row" key={item.requestId}>
                          <span>
                            <strong>Pending device</strong>
                            <small>{item.deviceId.slice(0, 12)}…</small>
                          </span>
                          <button onClick={() => void approvePeer(item.requestId)}>Approve</button>
                        </article>
                      ))}
                      {syncDevices.map((item) => (
                        <article className="provider-row" key={item.deviceId}>
                          <span>
                            <strong>{item.role === 'owner' ? 'This workspace owner' : 'Peer device'}</strong>
                            <small>
                              {item.deviceId.slice(0, 12)}… · {item.status}
                            </small>
                          </span>
                          {item.role !== 'owner' && item.status === 'active' && <button onClick={() => void revokePeer(item.deviceId)}>Revoke</button>}
                        </article>
                      ))}
                    </>
                  )}
                  {desktopSync?.configured&&deviceControl&&<div className="device-control-panel"><h4>Trusted device commands</h4><p className="settings-copy">User-dispatched, encrypted Waypoint commands only. An enrolled peer may decline until its worker policy is enabled. Remote terminal and remote Codex/Claude agents are not enabled in this slice.</p><div className="drawer-actions"><button onClick={()=>void toggleDeviceWorker()}>{deviceControl.policy.enabled?'Disable this device worker':'Enable this device worker'}</button></div>{syncDevices.filter((item)=>item.status==='active'&&item.deviceId!==desktopSync.deviceId).map((item)=><article className="provider-row" key={`worker-${item.deviceId}`}><span><strong>Enrolled peer</strong><small>{item.deviceId.slice(0,12)}…</small></span><button onClick={()=>void dispatchDeviceSummary(item.deviceId)}>Queue summary</button></article>)}<h4>Command history</h4><div className="activity-list">{deviceControl.jobs.length?deviceControl.jobs.slice(0,20).map((job)=><article className="activity-item execution" key={job.id}><span/><div><strong>{job.capability} · {job.status}</strong><small>{job.resultSummary??job.errorCode??`Target ${job.targetDeviceId.slice(0,12)}…`}</small><small>{new Date(job.updatedAt).toLocaleString()} · lease/status events {job.events.length}</small><details><summary>Execution history</summary>{job.events.map((event)=><small key={event.sequence}>{event.sequence} · {event.type} · {event.summary}</small>)}</details></div>{['queued','leased','running'].includes(job.status)?<button className="quiet-button" onClick={()=>workspace&&void window.waypoint.cancelDeviceCommand(workspace.id,job.id).then(()=>refresh()).catch(showError)}>Cancel</button>:<button className="quiet-button" onClick={()=>workspace&&window.confirm('Permanently delete this command history and its sync record?')&&void window.waypoint.deleteDeviceCommand(workspace.id,job.id).then(()=>refresh()).catch(showError)}>Delete</button>}</article>):<p className="empty-copy">No cross-device commands in this workspace.</p>}</div></div>}
                </section>
                <section>
                  <h3>Backup & recovery</h3>
                  <p className="drawer-intro">Backups are plaintext. Keep them in a protected location.</p>
                  <div className="drawer-actions">
                    <button onClick={() => void exportWorkspace()}>Back up workspace</button>
                    <button className="secondary" onClick={() => void restoreWorkspace()}>
                      Restore backup
                    </button>
                    <button className="secondary" onClick={()=>void verifyBackup()}>Verify backup</button>
                    <button className="secondary" onClick={()=>void drillBackup()}>Run restore drill</button>
                  </div>
                  <p className="drawer-intro">Verification reads only the selected file. A restore drill uses the real restore path in a temporary local workspace, checks database, files, indexes, and counts, then removes the drill data.</p>
                </section>
                <section>
                  <h3>Provider status</h3>
                  {capabilities.map((item) => (
                    <p className="provider-row" key={item.name}>
                      <strong>{item.name}</strong>
                      <span>{item.available && item.compatible !== false ? 'Ready' : item.compatibilityError || item.error}</span>
                    </p>
                  ))}
                </section>
                <section>
                  <h3>Recent execution budgets</h3>
                  <p className="drawer-intro">Every local run records a fixed approval and resource envelope. Automatic retries, external cost, peer execution, and fallback remain off.</p>
                  {runs.slice(0,5).map((run)=>{const budget=run.budget as Record<string,unknown>|undefined;return budget?<p className="provider-row" key={String(run.id)}><strong>{String(run.cli)} · {String(budget.kind)}</strong><span>{Math.round(Number(budget.maxDurationMs)/1000)}s · {Math.round(Number(budget.maxOutputBytes)/1024/1024)} MiB output · 1 attempt · {String(budget.approvalOrigin).replaceAll('-',' ')}</span></p>:null})}
                  {!runs.some((run)=>run.budget)&&<p className="drawer-empty">No budgeted run has been recorded yet.</p>}
                </section>
              </div>
            )}
            {drawer === 'automations' && (
              <div className="drawer-body">
                <p className="drawer-intro">Signed inbound events can arrive through the opaque Waypoint relay and remain quarantined for review. Local synthetic rules and playbooks remain paused or dry-run-only. No event can invoke a model, rule, command, schedule, or external effect.</p>
                <section>
                  <h3>Signed inbound <span>{webhookEvents.length}</span></h3>
                  {!webhookChannels&&<p className="drawer-empty">Set up and enroll desktop sync before creating a production inbound channel.</p>}
                  {webhookChannels&&<><div className="automation-boundary" role="status"><strong>{webhookChannels.killSwitch?'Inbound kill switch active':'Encrypted inbound enabled'}</strong><span>signed · replay protected · opaque relay · quarantined · zero effects</span></div><div className="drawer-actions"><button onClick={()=>void createWebhookChannel().catch(showError)}>New inbound channel</button><button onClick={()=>void refreshWebhookEvents().catch(showError)}>Fetch inbound</button><button className="secondary" onClick={()=>void window.waypoint.setWebhookKill(workspace!.id,!webhookChannels.killSwitch).then(()=>window.waypoint.webhookChannels(workspace!.id)).then(setWebhookChannels).catch(showError)}>{webhookChannels.killSwitch?'Resume inbound':'Kill inbound'}</button></div></>}
                  {webhookChannels?.channels.map((channel)=><article className={`playbook-item ${channel.status}`} key={channel.channelId}><header><div><small>{channel.status} · secret v{channel.secretVersion}</small><strong>{channel.label}</strong><small>Channel {channel.channelId.slice(0,10)}… · recipient {channel.recipientDeviceId.slice(0,10)}…</small><span>The signing secret is protected and cannot be displayed again. Rotate to issue a replacement.</span></div></header><div className="meeting-actions"><button disabled={channel.status!=='active'} onClick={()=>void rotateWebhookChannel(channel.channelId).catch(showError)}>Rotate</button><button disabled={channel.status!=='active'} onClick={()=>void window.waypoint.revokeWebhookChannel(workspace!.id,channel.channelId).then(()=>window.waypoint.webhookChannels(workspace!.id)).then(setWebhookChannels).catch(showError)}>Revoke</button><button onClick={()=>void window.waypoint.deleteWebhookChannel(workspace!.id,channel.channelId).then(()=>window.waypoint.webhookChannels(workspace!.id)).then(setWebhookChannels).catch(showError)}>Delete</button></div></article>)}
                  {webhookEvents.map((event)=><article className="playbook-item paused" key={event.id}><header><div><small>quarantined · untrusted · {event.proposedEffects} effects</small><strong>{event.eventType}</strong><small>Channel {event.channelId.slice(0,10)}… · payload {event.payloadDigest.slice(0,10)}…</small><span>{JSON.stringify(event.payload)}</span></div><button onClick={()=>void deleteWebhookEvent(event.id).catch(showError)}>Delete</button></header></article>)}
                </section>
                <div className="automation-boundary" role="status">
                  <strong>{triggerLab?.killSwitch?'Kill switch active':'Local simulation only'}</strong>
                  <span>webhook.fixture.local · quarantined · zero effects · network off</span>
                </div>
                <div className="drawer-actions">
                  <button onClick={()=>void createTriggerFixture().catch(showError)}>Simulate webhook</button>
                  <button className="secondary" onClick={()=>void toggleTriggerKill().catch(showError)}>{triggerLab?.killSwitch?'Resume evaluation':'Kill all triggers'}</button>
                  <button onClick={() => void createPlaybook().catch(showError)}>New fixture playbook</button>
                </div>
                <section>
                  <h3>Proactive rule lab <span>{triggerLab?.rules.length??0}</span></h3>
                  {triggerLab?.rules.map((rule)=>{const event=triggerLab.events.find((item)=>item.id===rule.sourceEventId);return <article className={`playbook-item ${rule.status}`} key={rule.id}>
                    <header><div><small>v{rule.version} · {rule.status} · {event?.status??'source missing'}</small><strong>{rule.statement}</strong><small>{event?.eventType} · source digest {event?.payloadDigest.slice(0,10)}… · definition {rule.definitionDigest.slice(0,10)}…</small><span>Observed locally. Payload is quarantined untrusted fixture data and is not shown or interpreted as authority.</span></div><button onClick={()=>void deleteTriggerEvent(rule.sourceEventId).catch(showError)}>Delete</button></header>
                    <div className="meeting-actions">{rule.status==='suggested'&&<button disabled={triggerLab.killSwitch} onClick={()=>void approveTriggerRule(rule.id).catch(showError)}>Approve paused rule</button>}<button disabled={triggerLab.killSwitch||rule.status!=='paused'} onClick={()=>void dryRunTrigger(rule.id).catch(showError)}>Dry run</button><button disabled={triggerLab.killSwitch||rule.status!=='paused'} onClick={()=>void dryRunTrigger(rule.id,true).catch(showError)}>Simulate failure</button></div>
                    {rule.runs.slice(0,5).map((run)=><small className="playbook-run" key={run.id}>{run.status.replace('_',' ')} · attempt {run.attempt} · {run.proposedEffects} effects</small>)}
                  </article>})}
                  {!triggerLab?.rules.length&&<p className="drawer-empty">No local webhook fixtures. Simulation never exposes a listener or activates a rule.</p>}
                </section>
                <section>
                  <h3>
                    Paused playbooks <span>{playbooks.length}</span>
                  </h3>
                  {playbooks.map((item) => (
                    <article className={`playbook-item ${item.status}`} key={item.id}>
                      <header>
                        <div>
                          <small>
                            v{item.version} · {item.status} · {item.timezone}
                          </small>
                          <strong>{item.title}</strong>
                          <small>
                            Definition v{item.definition.schemaVersion} · {item.definition.connector.provider}@{item.definition.connector.version} · {item.definition.steps.map((step) => step.operation).join(' → ')}
                          </small>
                          <small>
                            Authority: {item.permission.accountId} / {item.permission.tenantId} · {item.permission.scopes.join(', ')} · read only
                          </small>
                          <span>
                            Preview only: daily {String(item.hour).padStart(2, '0')}:{String(item.minute).padStart(2, '0')} · next{' '}
                            {new Intl.DateTimeFormat(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                              timeZone: item.timezone,
                            }).format(new Date(item.nextOccurrence))}
                          </span>
                        </div>
                        <button onClick={() => void deletePlaybook(item.id).catch(showError)}>Delete</button>
                      </header>
                      <div className="meeting-actions">
                        <button disabled={item.status === 'killed'} onClick={() => void dryRunPlaybook(item.id).catch(showError)}>
                          Dry run
                        </button>
                        <button disabled={item.status === 'killed' || !dryRunDigests[item.id]} onClick={() => void runPlaybook(item.id).catch(showError)}>
                          Run fixture now
                        </button>
                        <button disabled={item.status === 'killed' || !dryRunDigests[item.id]} onClick={() => void runPlaybook(item.id, true).catch(showError)}>
                          Simulate failure
                        </button>
                        <button disabled={item.status === 'killed'} onClick={() => void killPlaybook(item.id).catch(showError)}>
                          Kill switch
                        </button>
                      </div>
                      {item.runs.slice(0, 5).map((run) => (
                        <small className="playbook-run" key={run.id}>
                          {run.status.replace('_', ' ')} · attempt {run.attempt} · {run.inputCount} in / {run.outputCount} out · {run.proposedEffects} effects
                        </small>
                      ))}
                    </article>
                  ))}
                  {!playbooks.length && <p className="drawer-empty">No fixture playbooks. Creating one never enables a schedule or external connector.</p>}
                </section>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
