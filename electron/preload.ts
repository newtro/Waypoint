import { contextBridge, ipcRenderer } from 'electron';
let currentWorkspaceId: string | undefined;

contextBridge.exposeInMainWorld('waypoint', {
  bootstrap: () => ipcRenderer.invoke('waypoint:bootstrap'),
  activityCaptureStatus:(workspaceId:string)=>ipcRenderer.invoke('waypoint:activity-capture-status',{workspaceId}),
  updateActivityCapture:(workspaceId:string,policy:unknown)=>ipcRenderer.invoke('waypoint:activity-capture-update',{workspaceId,policy}),
  listActivitySnapshots:(workspaceId:string,query?:string)=>ipcRenderer.invoke('waypoint:activity-capture-list',{workspaceId,query}),
  readActivitySnapshot:(workspaceId:string,snapshotId:string)=>ipcRenderer.invoke('waypoint:activity-capture-read',{workspaceId,snapshotId}),
  deleteActivitySnapshot:(workspaceId:string,snapshotId:string)=>ipcRenderer.invoke('waypoint:activity-capture-delete',{workspaceId,snapshotId}),
  deleteAllActivitySnapshots:(workspaceId:string)=>ipcRenderer.invoke('waypoint:activity-capture-delete-all',{workspaceId}),
  purgeExpiredActivitySnapshots:(workspaceId:string)=>ipcRenderer.invoke('waypoint:activity-capture-purge',{workspaceId}),
  createWorkspace: (name: string) => ipcRenderer.invoke('waypoint:create-workspace', { name }),
  createDocument: (workspaceId: string, title: string, body: string) =>
    ipcRenderer.invoke('waypoint:create-document', {
      workspaceId,
      title,
      body,
    }),
  captureMessageAsDocument: (workspaceId: string, messageId: string) =>
    ipcRenderer.invoke('waypoint:capture-message-as-document', {
      workspaceId,
      messageId,
    }),
  updateDocument: (workspaceId: string, objectId: string, title: string, body: string) =>
    ipcRenderer.invoke('waypoint:update-document', {
      workspaceId,
      objectId,
      title,
      body,
    }),
  listDocuments: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-documents', { workspaceId }),
  importDocument:(workspaceId:string)=>ipcRenderer.invoke('waypoint:import-document',{workspaceId}),
  reindexImportedDocument:(workspaceId:string,documentId:string)=>ipcRenderer.invoke('waypoint:reindex-imported-document',{workspaceId,documentId}),
  documentIndexStatus:(workspaceId:string,documentId:string)=>ipcRenderer.invoke('waypoint:document-index-status',{workspaceId,documentId}),
  rollbackDocumentIndex:(workspaceId:string,documentId:string)=>ipcRenderer.invoke('waypoint:rollback-document-index',{workspaceId,documentId}),
  syncStatus: (workspaceId: string) => ipcRenderer.invoke('waypoint:sync-status', { workspaceId }),
  desktopSyncStatus: (workspaceId: string) => ipcRenderer.invoke('waypoint:desktop-sync-status', { workspaceId }),
  initializeDesktopSync: (workspaceId: string) => ipcRenderer.invoke('waypoint:desktop-sync-initialize', { workspaceId }),
  createSyncInvitation: (workspaceId: string) =>
    ipcRenderer.invoke('waypoint:desktop-sync-create-invitation', {
      workspaceId,
    }),
  submitSyncEnrollment: (token: string) => ipcRenderer.invoke('waypoint:desktop-sync-submit-enrollment', { token }),
  completeSyncEnrollment: (workspaceId: string) =>
    ipcRenderer.invoke('waypoint:desktop-sync-complete-enrollment', {
      workspaceId,
    }),
  pendingSyncEnrollments: (workspaceId: string) => ipcRenderer.invoke('waypoint:desktop-sync-pending', { workspaceId }),
  approveSyncEnrollment: (workspaceId: string, requestId: string) =>
    ipcRenderer.invoke('waypoint:desktop-sync-approve', {
      workspaceId,
      requestId,
    }),
  syncDevices: (workspaceId: string) => ipcRenderer.invoke('waypoint:desktop-sync-devices', { workspaceId }),
  revokeSyncDevice: (workspaceId: string, deviceId: string) =>
    ipcRenderer.invoke('waypoint:desktop-sync-revoke', {
      workspaceId,
      deviceId,
    }),
  resumeSyncRotation: (workspaceId: string) =>
    ipcRenderer.invoke('waypoint:desktop-sync-resume-rotation', {
      workspaceId,
    }),
  syncNow: (workspaceId: string) => ipcRenderer.invoke('waypoint:desktop-sync-now', { workspaceId }),
  deviceControlStatus:(workspaceId:string)=>ipcRenderer.invoke('waypoint:device-control-status',{workspaceId}),
  updateDeviceControl:(workspaceId:string,policy:unknown)=>ipcRenderer.invoke('waypoint:device-control-update',{workspaceId,policy}),
  dispatchDeviceCommand:(workspaceId:string,targetDeviceId:string,instruction:string,idempotencyKey:string)=>ipcRenderer.invoke('waypoint:device-control-dispatch',{workspaceId,targetDeviceId,instruction,idempotencyKey}),
  cancelDeviceCommand:(workspaceId:string,jobId:string)=>ipcRenderer.invoke('waypoint:device-control-cancel',{workspaceId,jobId}),
  deleteDeviceCommand:(workspaceId:string,jobId:string)=>ipcRenderer.invoke('waypoint:device-control-delete',{workspaceId,jobId}),
  webhookChannels:(workspaceId:string)=>ipcRenderer.invoke('waypoint:webhook-channels',{workspaceId}),
  createWebhookChannel:(workspaceId:string,label:string)=>ipcRenderer.invoke('waypoint:webhook-channel-create',{workspaceId,label}),
  rotateWebhookChannel:(workspaceId:string,channelId:string)=>ipcRenderer.invoke('waypoint:webhook-channel-rotate',{workspaceId,channelId}),
  revokeWebhookChannel:(workspaceId:string,channelId:string)=>ipcRenderer.invoke('waypoint:webhook-channel-revoke',{workspaceId,channelId}),
  deleteWebhookChannel:(workspaceId:string,channelId:string)=>ipcRenderer.invoke('waypoint:webhook-channel-delete',{workspaceId,channelId}),
  setWebhookKill:(workspaceId:string,active:boolean)=>ipcRenderer.invoke('waypoint:webhook-kill',{workspaceId,active}),
  fetchWebhookEvents:(workspaceId:string)=>ipcRenderer.invoke('waypoint:webhook-fetch',{workspaceId}),
  listWebhookEvents:(workspaceId:string)=>ipcRenderer.invoke('waypoint:webhook-events',{workspaceId}),
  deleteWebhookEvent:(workspaceId:string,eventId:string)=>ipcRenderer.invoke('waypoint:webhook-event-delete',{workspaceId,eventId}),
  searchText: (workspaceId: string, query: string) => ipcRenderer.invoke('waypoint:search-text', { workspaceId, query }),
  searchSemantic: (workspaceId: string, query: string) => ipcRenderer.invoke('waypoint:search-semantic', { workspaceId, query }),
  indexDocument: (workspaceId: string, objectId: string) => ipcRenderer.invoke('waypoint:index-document', { workspaceId, objectId }),
  deleteDocument: (workspaceId: string, objectId: string) => ipcRenderer.invoke('waypoint:delete-document', { workspaceId, objectId }),
  deleteObject: (workspaceId: string, kind: string, objectId: string) =>
    ipcRenderer.invoke('waypoint:delete-object', {
      workspaceId,
      kind,
      objectId,
    }),
  attachDocument: (workspaceId: string, objectId: string) => ipcRenderer.invoke('waypoint:attach-document', { workspaceId, objectId }),
  selectChatAttachments: (workspaceId: string, chatId: string) =>
    ipcRenderer.invoke('waypoint:select-chat-attachments', {
      workspaceId,
      chatId,
    }),
  listChatAttachments: (workspaceId: string, chatId: string) =>
    ipcRenderer.invoke('waypoint:list-chat-attachments', {
      workspaceId,
      chatId,
    }),
  deleteAttachment: (workspaceId: string, attachmentId: string) =>
    ipcRenderer.invoke('waypoint:delete-attachment', {
      workspaceId,
      attachmentId,
    }),
  graph: (workspaceId: string) => ipcRenderer.invoke('waypoint:graph', { workspaceId }),
  activity: (workspaceId: string, filters?: { families?: string[]; query?: string; limit?: number }) => ipcRenderer.invoke('waypoint:activity', { workspaceId, ...filters }),
  createMeeting: (workspaceId: string, title: string, consentAcknowledged: boolean) =>
    ipcRenderer.invoke('waypoint:create-meeting', {
      workspaceId,
      title,
      consentAcknowledged,
    }),
  finalizeMeeting: (workspaceId: string, meetingId: string, mediaType: string, audio: Uint8Array) =>
    ipcRenderer.invoke('waypoint:finalize-meeting', {
      workspaceId,
      meetingId,
      mediaType,
      audio,
    }),
  failMeeting: (workspaceId: string, meetingId: string, failureCode: string) =>
    ipcRenderer.invoke('waypoint:fail-meeting', {
      workspaceId,
      meetingId,
      failureCode,
    }),
  listMeetings: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-meetings', { workspaceId }),
  updateMeetingTranscript: (workspaceId: string, meetingId: string, transcript: string, reviewed: boolean) =>
    ipcRenderer.invoke('waypoint:update-meeting-transcript', {
      workspaceId,
      meetingId,
      transcript,
      reviewed,
    }),
  saveMeetingMemory: (workspaceId: string, meetingId: string) =>
    ipcRenderer.invoke('waypoint:save-meeting-memory', {
      workspaceId,
      meetingId,
    }),
  deleteMeeting: (workspaceId: string, meetingId: string) => ipcRenderer.invoke('waypoint:delete-meeting', { workspaceId, meetingId }),
  readMeetingAudio: (workspaceId: string, meetingId: string) =>
    ipcRenderer.invoke('waypoint:read-meeting-audio', {
      workspaceId,
      meetingId,
    }),
  exportMeetingAudio: (workspaceId: string, meetingId: string) =>
    ipcRenderer.invoke('waypoint:export-meeting-audio', {
      workspaceId,
      meetingId,
    }),
  meetingTranscriptionCapability: () => ipcRenderer.invoke('waypoint:meeting-transcription-capability'),
  createLocalWebhookFixture:(workspaceId:string,eventType:string,idempotencyKey:string,payload:Record<string,string|number|boolean|null>)=>ipcRenderer.invoke('waypoint:create-local-webhook-fixture',{workspaceId,eventType,idempotencyKey,payload}),
  listLocalTriggerLab:(workspaceId:string)=>ipcRenderer.invoke('waypoint:list-local-trigger-lab',{workspaceId}),
  approveLocalTriggerRule:(workspaceId:string,ruleId:string)=>ipcRenderer.invoke('waypoint:approve-local-trigger-rule',{workspaceId,ruleId}),
  dryRunLocalTriggerRule:(workspaceId:string,ruleId:string,simulateFailure=false)=>ipcRenderer.invoke('waypoint:dry-run-local-trigger-rule',{workspaceId,ruleId,simulateFailure}),
  setLocalTriggerKill:(workspaceId:string,enabled:boolean)=>ipcRenderer.invoke('waypoint:set-local-trigger-kill',{workspaceId,enabled}),
  deleteLocalTriggerEvent:(workspaceId:string,eventId:string)=>ipcRenderer.invoke('waypoint:delete-local-trigger-event',{workspaceId,eventId}),
  createFixturePlaybook: (workspaceId: string, title: string, timezone: string, hour: number, minute: number) =>
    ipcRenderer.invoke('waypoint:create-fixture-playbook', {
      workspaceId,
      title,
      timezone,
      hour,
      minute,
    }),
  listFixturePlaybooks: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-fixture-playbooks', { workspaceId }),
  dryRunFixturePlaybook: (workspaceId: string, playbookId: string) =>
    ipcRenderer.invoke('waypoint:dry-run-fixture-playbook', {
      workspaceId,
      playbookId,
    }),
  runFixturePlaybook: (workspaceId: string, playbookId: string, dryRunDigest: string, simulateFailure = false) =>
    ipcRenderer.invoke('waypoint:run-fixture-playbook', {
      workspaceId,
      playbookId,
      dryRunDigest,
      simulateFailure,
    }),
  killFixturePlaybook: (workspaceId: string, playbookId: string) =>
    ipcRenderer.invoke('waypoint:kill-fixture-playbook', {
      workspaceId,
      playbookId,
    }),
  deleteFixturePlaybook: (workspaceId: string, playbookId: string) =>
    ipcRenderer.invoke('waypoint:delete-fixture-playbook', {
      workspaceId,
      playbookId,
    }),
  listChats: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-chats', { workspaceId }),
  cliCapabilities: () => ipcRenderer.invoke('waypoint:cli-capabilities'),
  proposeChatRoute:(workspaceId:string,chatId:string,preferred:'codex'|'claude',securityProfileId:string,attachmentIds:string[]=[],allowFallback=false)=>ipcRenderer.invoke('waypoint:propose-chat-route',{workspaceId,chatId,preferred,securityProfileId,attachmentIds,allowFallback}),
  listSecurityProfiles: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-security-profiles', { workspaceId }),
  listExecutions: (workspaceId: string, chatId?: string) => {
    currentWorkspaceId = workspaceId;
    return ipcRenderer.invoke('waypoint:list-executions', {
      workspaceId,
      chatId,
    });
  },
  runChat: (workspaceId: string, chatId: string, sourceMessageId: string, cli: 'codex' | 'claude', securityProfileId: string, prompt: string, model?: string, parentExecutionId?: string, attachmentIds: string[] = [],taskType?:'analyze'|'summarize'|'critique') =>
    ipcRenderer.invoke('waypoint:run-chat', {
      workspaceId,
      chatId,
      sourceMessageId,
      cli,
      securityProfileId,
      prompt,
      model,
      parentExecutionId,
      attachmentIds,
      taskType,
    }),
  cancelExecution: (runId: string) => {
    if (!currentWorkspaceId) throw new Error('No active workspace');
    return ipcRenderer.invoke('waypoint:cancel-execution', {
      workspaceId: currentWorkspaceId,
      runId,
    });
  },
  createChat: (workspaceId: string, title: string) => ipcRenderer.invoke('waypoint:create-chat', { workspaceId, title }),
  captureChat: (workspaceId: string, title: string, body: string) => ipcRenderer.invoke('waypoint:capture-chat', { workspaceId, title, body }),
  addMessage: (workspaceId: string, chatId: string, role: string, body: string, attachmentIds: string[] = []) =>
    ipcRenderer.invoke('waypoint:add-message', {
      workspaceId,
      chatId,
      role,
      body,
      attachmentIds,
    }),
  listMemories: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-memories', { workspaceId }),
  scanMemorySuggestions: (workspaceId: string, chatId?: string) =>
    ipcRenderer.invoke('waypoint:scan-memory-suggestions', {
      workspaceId,
      chatId,
    }),
  listMemorySuggestions: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-memory-suggestions', { workspaceId }),
  resolveMemorySuggestion: (workspaceId: string, suggestionId: string, action: 'accept' | 'reject', title?: string, body?: string) =>
    ipcRenderer.invoke('waypoint:resolve-memory-suggestion', {
      workspaceId,
      suggestionId,
      action,
      title,
      body,
    }),
  listCommitments: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-commitments', { workspaceId }),
  setCommitmentCompleted: (workspaceId: string, commitmentId: string, completed: boolean) =>
    ipcRenderer.invoke('waypoint:set-commitment-completed', {
      workspaceId,
      commitmentId,
      completed,
    }),
  composeDailyBriefing: (workspaceId: string, timezone: string) =>
    ipcRenderer.invoke('waypoint:compose-daily-briefing', {
      workspaceId,
      timezone,
    }),
  dismissBriefingItem: (workspaceId: string, sourceId: string, sourceKind: 'commitment' | 'document' | 'memory', localDay: string) =>
    ipcRenderer.invoke('waypoint:dismiss-briefing-item', {
      workspaceId,
      sourceId,
      sourceKind,
      localDay,
    }),
  scanRuleSuggestions: (workspaceId: string) => ipcRenderer.invoke('waypoint:scan-rule-suggestions', { workspaceId }),
  listRuleSuggestions: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-rule-suggestions', { workspaceId }),
  dryRunRuleSuggestion: (workspaceId: string, suggestionId: string) =>
    ipcRenderer.invoke('waypoint:dry-run-rule-suggestion', {
      workspaceId,
      suggestionId,
    }),
  resolveRuleSuggestion: (workspaceId: string, suggestionId: string, action: 'approve' | 'reject') =>
    ipcRenderer.invoke('waypoint:resolve-rule-suggestion', {
      workspaceId,
      suggestionId,
      action,
    }),
  listLearnedRules: (workspaceId: string) => ipcRenderer.invoke('waypoint:list-learned-rules', { workspaceId }),
  setLearnedRuleEnabled: (workspaceId: string, ruleId: string, enabled: boolean) =>
    ipcRenderer.invoke('waypoint:set-learned-rule-enabled', {
      workspaceId,
      ruleId,
      enabled,
    }),
  revertLearnedRule: (workspaceId: string, ruleId: string) => ipcRenderer.invoke('waypoint:revert-learned-rule', { workspaceId, ruleId }),
  createMemory: (workspaceId: string, title: string, body: string, sourceObjectId?: string) =>
    ipcRenderer.invoke('waypoint:create-memory', {
      workspaceId,
      title,
      body,
      sourceObjectId,
    }),
  captureMemory: (workspaceId: string, title: string, body: string, sourceObjectId?: string, sourceOwned = false) =>
    ipcRenderer.invoke('waypoint:capture-memory', {
      workspaceId,
      title,
      body,
      sourceObjectId,
      sourceOwned,
    }),
  createRelationship: (workspaceId: string, fromId: string, toId: string, type: string) =>
    ipcRenderer.invoke('waypoint:create-relationship', {
      workspaceId,
      fromId,
      toId,
      type,
    }),
  exportWorkspace: (workspaceId: string) => ipcRenderer.invoke('waypoint:export-workspace', { workspaceId }),
  verifyBackup: () => ipcRenderer.invoke('waypoint:verify-backup'),
  drillBackup:()=>ipcRenderer.invoke('waypoint:drill-backup'),
  restoreWorkspace: () => ipcRenderer.invoke('waypoint:restore-workspace'),
  diagnostics: (workspaceId: string) => ipcRenderer.invoke('waypoint:diagnostics', { workspaceId }),
  rebuildSearch: (workspaceId: string) => ipcRenderer.invoke('waypoint:rebuild-search', { workspaceId }),
  exportDiagnostics: (workspaceId: string) => ipcRenderer.invoke('waypoint:export-diagnostics', { workspaceId }),
  toolGatewayCapabilities:()=>ipcRenderer.invoke('waypoint:tool-gateway-capabilities'),
  toolGatewaySettings:(workspaceId:string)=>ipcRenderer.invoke('waypoint:tool-gateway-settings',{workspaceId}),
  updateToolGatewaySettings:(workspaceId:string,value:{stopped:boolean;denyPatterns:string[];suppressCommit:boolean;suppressPush:boolean})=>ipcRenderer.invoke('waypoint:tool-gateway-update-settings',{workspaceId,...value}),
  toolGatewayReceipts:(workspaceId:string,limit=100)=>ipcRenderer.invoke('waypoint:tool-gateway-receipts',{workspaceId,limit}),
  toolFailures:(workspaceId:string,limit=100)=>ipcRenderer.invoke('waypoint:tool-failures',{workspaceId,limit}),
  deleteToolFailure:(workspaceId:string,id:string)=>ipcRenderer.invoke('waypoint:delete-tool-failure',{workspaceId,id}),
  openRouterStatus:()=>ipcRenderer.invoke('waypoint:openrouter-status'),
  cliModelCatalog:()=>ipcRenderer.invoke('waypoint:cli-model-catalog'),
  chatModelPreferences:(workspaceId:string)=>ipcRenderer.invoke('waypoint:chat-model-preferences',{workspaceId}),
  setChatModelPreference:(workspaceId:string,provider:'codex'|'claude',model:string)=>ipcRenderer.invoke('waypoint:chat-model-preference',{workspaceId,provider,model}),
  setOpenRouterKey:(apiKey:string)=>ipcRenderer.invoke('waypoint:openrouter-set-key',{apiKey}),
  removeOpenRouterKey:()=>ipcRenderer.invoke('waypoint:openrouter-remove-key'),
  updateOpenRouterSettings:(value:unknown)=>ipcRenderer.invoke('waypoint:openrouter-update-settings',value),
  runOpenRouterChat:(value:unknown)=>ipcRenderer.invoke('waypoint:run-openrouter-chat',value),
  cancelOpenRouterRun:(workspaceId:string,runId:string)=>ipcRenderer.invoke('waypoint:cancel-openrouter-run',{workspaceId,runId}),
  voiceCapability:()=>ipcRenderer.invoke('waypoint:voice-capability'),
  configureVoiceRuntime:()=>ipcRenderer.invoke('waypoint:voice-configure'),
  voicePreferences:(workspaceId:string)=>ipcRenderer.invoke('waypoint:voice-preferences',{workspaceId}),
  updateVoicePreferences:(workspaceId:string,value:{mode:'push_to_talk'|'hands_free';microphoneId:string;outputVoice:'system'})=>ipcRenderer.invoke('waypoint:voice-update-preferences',{workspaceId,...value}),
  removeVoiceRuntime:()=>ipcRenderer.invoke('waypoint:voice-remove-runtime'),
  transcribeVoice:(workspaceId:string,chatId:string,mode:'push_to_talk'|'hands_free',audio:Uint8Array)=>ipcRenderer.invoke('waypoint:voice-transcribe',{workspaceId,chatId,mode,audio}),
  speakVoice:(workspaceId:string,chatId:string,turnId:number,text:string)=>ipcRenderer.invoke('waypoint:voice-speak',{workspaceId,chatId,turnId,text}),
  stopVoice:(workspaceId:string,chatId:string)=>ipcRenderer.invoke('waypoint:voice-stop',{workspaceId,chatId}),
  onVoiceSpeechState:(listener:(event:{workspaceId:string;chatId:string;turnId:number;result:'completed'|'canceled'|'failed'})=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:{workspaceId:string;chatId:string;turnId:number;result:'completed'|'canceled'|'failed'})=>listener(value);ipcRenderer.on('waypoint:voice-speech-state',handler);return()=>ipcRenderer.removeListener('waypoint:voice-speech-state',handler)},
  executeTool:(request:unknown)=>ipcRenderer.invoke('waypoint:tool-gateway-execute',request),
  cancelTool:(workspaceId:string,runId:string)=>ipcRenderer.invoke('waypoint:tool-gateway-cancel',{workspaceId,runId}),
  onToolProgress:(listener:(event:unknown)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>listener(value);ipcRenderer.on('waypoint:tool-gateway-progress',handler);return()=>ipcRenderer.removeListener('waypoint:tool-gateway-progress',handler)},
});
