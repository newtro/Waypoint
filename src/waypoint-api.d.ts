import type { ActivityFamily, ActivitySnapshotView, ActivityTimelineItem, AttachmentMetadata, FixturePlaybookView, GraphEdge, GraphNode, MeetingView, SanitizedSyncStatus, SearchResult, WorkspaceSummary } from '../electron/core/types';
import type { DiagnosticsReport } from '../electron/core/diagnostics';

declare global {
  interface Window {
    waypoint: {
      openExternal(url:string):Promise<{opened:true}>;
      bootstrap(): Promise<{ workspaces: WorkspaceSummary[] }>;
      activityCaptureStatus(workspaceId:string):Promise<{policy:{version:1;enabled:boolean;paused:boolean;retentionDays:90|183|365;syncRaw:boolean;exclusions:string[]};readiness:{available:false;state:string;reason:string;permissionRequired:boolean};storage:{count:number;bytes:number}}>;
      reflectionRuns(workspaceId:string):Promise<Array<{id:string;status:string;provider:string;providerVersion:string;policyVersion:string;budgetJson:string;omissionsJson:string;createdAt:string;updatedAt:string}>>;
      reflectionProposals(workspaceId:string,runId:string):Promise<Array<{id:string;kind:string;title:string;beforeBody:string;proposedBody:string;rationale:string;status:string;acceptedObjectId?:string;sourceIds:string;sourceDigests:string;createdAt:string;resolvedAt?:string}>>;
      startReflection(workspaceId:string,sourceIds:string[],provider:'codex'|'claude'):Promise<{runId:string;proposalCount:number}>;
      cancelReflection(workspaceId:string):Promise<{canceled:boolean}>;
      resolveReflection(workspaceId:string,proposalId:string,action:'accept'|'edit'|'reject'|'rollback',editedBody?:string):Promise<{memoryId?:string}|undefined>;
      updateActivityCapture(workspaceId:string,policy:{version:1;enabled:boolean;paused:boolean;retentionDays:90|183|365;syncRaw:boolean;exclusions:string[]}):ReturnType<Window['waypoint']['activityCaptureStatus']>;
      listActivitySnapshots(workspaceId:string,query?:string):Promise<ActivitySnapshotView[]>;
      readActivitySnapshot(workspaceId:string,snapshotId:string):Promise<{mediaType:'image/png';dataBase64:string}>;
      deleteActivitySnapshot(workspaceId:string,snapshotId:string):Promise<{deleted:true}>;
      deleteAllActivitySnapshots(workspaceId:string):Promise<{deleted:number}>;
      purgeExpiredActivitySnapshots(workspaceId:string):Promise<{purged:number}>;
      createWorkspace(name: string): Promise<WorkspaceSummary>;
      deleteWorkspace(workspaceId: string): Promise<WorkspaceSummary>;
      createDocument(workspaceId: string, title: string, body: string): Promise<{ id: string; revisionId: string }>;
      captureMessageAsDocument(workspaceId: string, messageId: string): Promise<{ id: string; revisionId: string }>;
      updateDocument(workspaceId: string, objectId: string, title: string, body: string): Promise<string>;
      listDocuments(workspaceId: string): Promise<
        Array<{
          id: string;
          title: string;
          body: string;
          revisionId: string;
          updatedAt: string;
        }>
      >;
      ensureChatTitle(workspaceId:string,chatId:string):Promise<{started:boolean}>;
      renameChat(workspaceId:string,chatId:string,title:string):Promise<{ok:true}>;
      importDocument(workspaceId:string):Promise<{canceled:boolean;state?:'indexed'|'provider_unavailable'|'index_busy'|'index_failed'|'failed';documentId?:string;revisionId?:string;attachmentId?:string;sourceName?:string;extractor?:string;extractorVersion?:string;warnings?:string[];chunkCount?:number;provider?:string;model?:string;modelDigest?:string;code?:string;message?:string}>;
      reindexImportedDocument(workspaceId:string,documentId:string):Promise<{state:'indexed'|'provider_unavailable'|'index_busy'|'index_failed'|'source_changed';chunkCount:number;provider:string;model:string;modelDigest?:string;message?:string}>;
      documentIndexStatus(workspaceId:string,documentId:string):Promise<{state:'indexed'|'not_indexed';chunkCount:number;sourceAvailable:boolean;sourceName?:string;provider?:string;model?:string;modelDigest?:string;policy?:string;generationDigest?:string;retainedGenerations:number}>;
      rollbackDocumentIndex(workspaceId:string,documentId:string):Promise<{state:'indexed';chunkCount:number;sourceAvailable:boolean;sourceName?:string;provider?:string;model?:string;modelDigest?:string;policy?:string;generationDigest?:string;retainedGenerations:number}>;
      syncStatus(workspaceId: string): Promise<SanitizedSyncStatus>;
      desktopSyncStatus(workspaceId: string): Promise<{
        configured: boolean;
        pendingEnrollment: boolean;
        deviceId?: string;
        keyEpoch: number;
        rotationTargetEpoch?: number;
        endpoint: string;
        transportMode:'hosted-relay'|'desktop-host';
        peerHost?:{running:boolean;mode:'desktop-host';endpoint?:string;reason:string;startedAt?:string;fingerprintSha256?:string;workspaceId?:string;identityRotated?:boolean};
      }>;
      startDesktopSyncHost(workspaceId:string):Promise<{canceled:boolean;running?:boolean;endpoint?:string;reason?:string}>;
      stopDesktopSyncHost(workspaceId:string):Promise<{running:boolean;mode:'desktop-host';endpoint?:string;reason:string}>;
      initializeDesktopSync(workspaceId: string): Promise<{
        canceled: boolean;
        bootstrap?: {
          workspaceId: string;
          deviceId: string;
          signingPublicKey: string;
          encryptionPublicKey: string;
          endpoint: string;
          bootstrapRequired: true;
        };
      }>;
      createSyncInvitation(workspaceId: string): Promise<{ token: string; expiresAt: string }>;
      submitSyncEnrollment(token: string): Promise<{ workspaceId: string; requestId: string; status: 'pending' }>;
      completeSyncEnrollment(workspaceId: string): Promise<{ configured: true; deviceId: string; keyEpoch: number }>;
      pendingSyncEnrollments(workspaceId: string): Promise<
        Array<{
          requestId: string;
          deviceId: string;
          createdAt: string;
          expiresAt: string;
        }>
      >;
      approveSyncEnrollment(workspaceId: string, requestId: string): Promise<{ canceled: boolean; status?: 'approved' }>;
      syncDevices(workspaceId: string): Promise<
        Array<{
          deviceId: string;
          role: string;
          status: string;
          enrolledAt: string;
          revokedAt?: string;
        }>
      >;
      revokeSyncDevice(workspaceId: string, deviceId: string): Promise<{ canceled: boolean; rotation?: { keyEpoch: number } }>;
      resumeSyncRotation(workspaceId: string): Promise<{ keyEpoch: number }>;
      syncNow(workspaceId: string): Promise<{ sent: number; received: number; activePeers: number }>;
      deviceControlStatus(workspaceId:string):Promise<{policy:{version:1;enabled:boolean;preferredDeviceId?:string;failover:boolean;allowedCapabilities:Array<'waypoint.workspace_summary'|'agent.codex'|'agent.claude'>;maxDurationMs:number;maxConcurrency:1};jobs:Array<{id:string;controllerDeviceId:string;targetDeviceId:string;capability:string;status:string;resultSummary?:string;errorCode?:string;createdAt:string;updatedAt:string;events:Array<{sequence:number;type:string;summary:string;createdAt:string}>}>;sync:{configured:boolean;deviceId?:string;keyEpoch:number};capabilities:Array<{id:string;available:boolean;label:string;reason?:string}>}>;
      updateDeviceControl(workspaceId:string,policy:unknown):Promise<{canceled:boolean;policy:Awaited<ReturnType<Window['waypoint']['deviceControlStatus']>>['policy']}>;
      dispatchDeviceCommand(workspaceId:string,targetDeviceId:string,instruction:string,idempotencyKey:string):Promise<{id:string}>;
      cancelDeviceCommand(workspaceId:string,jobId:string):Promise<{canceled:boolean}>;
      deleteDeviceCommand(workspaceId:string,jobId:string):Promise<{deleted:true}>;
      webhookChannels(workspaceId:string):Promise<{channels:Array<{channelId:string;workspaceId:string;recipientDeviceId:string;recipientPublicKey:string;label:string;secretVersion:number;status:'active'|'revoked';createdAt:string;rotatedAt:string;revokedAt?:string}>;killSwitch:boolean}>;
      createWebhookChannel(workspaceId:string,label:string):Promise<{channelId:string;workspaceId:string;recipientDeviceId:string;recipientPublicKey:string;label:string;secretVersion:number;status:'active';createdAt:string;rotatedAt:string;secret:string}>;
      rotateWebhookChannel(workspaceId:string,channelId:string):Promise<{channelId:string;secretVersion:number;secret:string}>;
      revokeWebhookChannel(workspaceId:string,channelId:string):Promise<{channelId:string;status:'revoked'}>;
      deleteWebhookChannel(workspaceId:string,channelId:string):Promise<{deleted:boolean}>;
      setWebhookKill(workspaceId:string,active:boolean):Promise<{active:boolean}>;
      fetchWebhookEvents(workspaceId:string):Promise<{imported:number}>;
      listWebhookEvents(workspaceId:string):Promise<Array<{id:string;sourceEventId:string;channelId:string;eventType:string;occurredAt:string;receivedAt:string;payload:Record<string,string|number|boolean|null>;payloadDigest:string;status:'quarantined';createdAt:string;proposedEffects:0}>>;
      deleteWebhookEvent(workspaceId:string,eventId:string):Promise<{ok:true}>;
      searchText(workspaceId: string, query: string): Promise<SearchResult[]>;
      searchSemantic(workspaceId: string, query: string): Promise<SearchResult[]>;
      indexDocument(workspaceId: string, objectId: string): Promise<{ ok: true; model: string; modelDigest: string }>;
      deleteDocument(workspaceId: string, objectId: string): Promise<{ ok: true }>;
      deleteObject(workspaceId: string, kind: 'document' | 'chat' | 'memory', objectId: string): Promise<{ ok: true }>;
      attachDocument(workspaceId: string, objectId: string): Promise<{ canceled: boolean; attachmentId?: string }>;
      selectChatAttachments(workspaceId: string, chatId: string): Promise<{ canceled: boolean; attachments: AttachmentMetadata[] }>;
      listChatAttachments(workspaceId: string, chatId: string): Promise<AttachmentMetadata[]>;
      deleteAttachment(workspaceId: string, attachmentId: string): Promise<{ ok: true }>;
      graph(workspaceId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
      activity(
        workspaceId: string,
        filters?: {
          families?: ActivityFamily[];
          query?: string;
          limit?: number;
        },
      ): Promise<ActivityTimelineItem[]>;
      createMeeting(workspaceId: string, title: string, consentAcknowledged: boolean): Promise<{ meetingId: string }>;
      finalizeMeeting(workspaceId: string, meetingId: string, mediaType: string, audio: Uint8Array): Promise<{ ok: true }>;
      failMeeting(workspaceId: string, meetingId: string, failureCode: string): Promise<{ ok: true }>;
      listMeetings(workspaceId: string): Promise<MeetingView[]>;
      updateMeetingTranscript(workspaceId: string, meetingId: string, transcript: string, reviewed: boolean): Promise<{ ok: true }>;
      saveMeetingMemory(workspaceId: string, meetingId: string): Promise<{ memoryId: string }>;
      deleteMeeting(workspaceId: string, meetingId: string): Promise<{ ok: true }>;
      readMeetingAudio(workspaceId: string, meetingId: string): Promise<{ mediaType: string; audio: Uint8Array<ArrayBuffer> }>;
      exportMeetingAudio(workspaceId: string, meetingId: string): Promise<{ canceled: boolean }>;
      meetingTranscriptionCapability(): Promise<{
        available: boolean;
        provider: string;
        speakerDiarization:boolean;
        reason: string;
      }>;
      startMeetingTranscription(workspaceId:string,meetingId:string):Promise<{runId:string}>;
      transcribeMeetingSegment(workspaceId:string,meetingId:string,runId:string,index:number,audio:Uint8Array):Promise<{completedSegments:number}>;
      finishMeetingTranscription(workspaceId:string,meetingId:string,runId:string):Promise<{transcript:string;provider:string}>;
      cancelMeetingTranscription(workspaceId:string,meetingId:string,runId:string):Promise<{canceled:boolean}>;
      createLocalWebhookFixture(workspaceId:string,eventType:string,idempotencyKey:string,payload:Record<string,string|number|boolean|null>):Promise<{eventId:string}>;
      listLocalTriggerLab(workspaceId:string):Promise<{killSwitch:boolean;authority:{source:string;network:false;publicIngress:false;schedule:false;model:false;externalEffects:false;unattended:false;proposedEffects:0};events:Array<{id:string;eventType:string;occurredAt:string;receivedAt:string;payloadDigest:string;status:'quarantined'}>;rules:Array<{id:string;sourceEventId:string;statement:string;version:number;definitionDigest:string;status:'suggested'|'paused'|'killed';createdAt:string;updatedAt:string;runs:Array<{id:string;status:'dry_run'|'retrying'|'dead_letter';attempt:number;proposedEffects:0;digest:string;createdAt:string}>}>}>;
      approveLocalTriggerRule(workspaceId:string,ruleId:string):Promise<{ok:true}>;
      dryRunLocalTriggerRule(workspaceId:string,ruleId:string,simulateFailure?:boolean):Promise<{status:'dry_run'|'retrying'|'dead_letter';attempt:number;proposedEffects:0;digest:string;idempotent:boolean}>;
      setLocalTriggerKill(workspaceId:string,enabled:boolean):Promise<{ok:true}>;
      deleteLocalTriggerEvent(workspaceId:string,eventId:string):Promise<{ok:true}>;
      createFixturePlaybook(workspaceId: string, title: string, timezone: string, hour: number, minute: number): Promise<{ playbookId: string }>;
      listFixturePlaybooks(workspaceId: string): Promise<FixturePlaybookView[]>;
      dryRunFixturePlaybook(
        workspaceId: string,
        playbookId: string,
      ): Promise<{
        inputCount: number;
        deduplicatedCount: number;
        titles: string[];
        proposedEffects: 0;
        omissions: string[];
        digest: string;
        permissionSnapshot: Record<string, unknown>;
      }>;
      runFixturePlaybook(
        workspaceId: string,
        playbookId: string,
        dryRunDigest: string,
        simulateFailure?: boolean,
      ): Promise<{
        runId: string;
        status: 'completed' | 'retrying' | 'dead_letter';
        idempotent: boolean;
      }>;
      killFixturePlaybook(workspaceId: string, playbookId: string): Promise<{ ok: true }>;
      deleteFixturePlaybook(workspaceId: string, playbookId: string): Promise<{ ok: true }>;
      listChats(workspaceId: string): Promise<
        Array<{
          id: string;
          title: string;
          updatedAt: string;
          titleOrigin: 'placeholder'|'automatic'|'manual';
          titleStatus: 'eligible'|'running'|'complete';
          messages: Array<{
            id: string;
            role: string;
            body: string;
            createdAt: string;
          }>;
        }>
      >;
      cliCapabilities(): Promise<
        Array<{
          name: 'codex' | 'claude';
          available: boolean;
          executable?: string;
          version?: string;
          error?: string;
          compatible?: boolean;
          compatibilityError?: string;
        }>
      >;
      proposeChatRoute(workspaceId:string,chatId:string,preferred:'codex'|'claude',securityProfileId:string,attachmentIds?:string[],allowFallback?:boolean):Promise<{version:1;selected?:'codex'|'claude';eligible:Array<'codex'|'claude'>;fallback:Array<'codex'|'claude'>;fallbackEnabled:boolean;device:'local';securityProfileId:string;explanation:string[];providers:Array<{provider:'codex'|'claude';eligible:boolean;version?:string;reason?:string;deliverableAttachmentIds:string[];localOnlyAttachmentIds:string[];privacyClass:'signed-in-cli';costClass:'subscription'}>}>;
      listSecurityProfiles(workspaceId: string): Promise<
        Array<{
          id: string;
          name: string;
          roots: string[];
          filesystem: 'read-only' | 'workspace-write';
          network: 'provider-only' | 'disabled';
          tools: string[];
          approval: 'always' | 'on-write';
          maxDurationMs: number;
          maxConcurrency: number;
          peerEligible: boolean;
          secretNames: string[];
        }>
      >;
      listExecutions(workspaceId: string, chatId?: string): Promise<Array<Record<string, unknown>>>;
      runChat(
        workspaceId: string,
        chatId: string,
        sourceMessageId: string,
        cli: 'codex' | 'claude',
        securityProfileId: string,
        prompt: string,
        model?: string,
        parentExecutionId?: string,
        attachmentIds?: string[],
        taskType?:'analyze'|'summarize'|'critique',
      ): Promise<{
        runId: string;
        status: 'running';
        attachmentDelivery: {
          passedToCli: string[];
          unsupported: Array<{ id: string; reason: string }>;
        };
      }>;
      cancelExecution(runId: string): Promise<{ canceled: boolean }>;
      createChat(workspaceId: string, title: string): Promise<string>;
      captureChat(workspaceId: string, title: string, body: string): Promise<string>;
      addMessage(workspaceId: string, chatId: string, role: 'user' | 'assistant' | 'system', body: string, attachmentIds?: string[]): Promise<string>;
      listMemories(workspaceId: string): Promise<
        Array<{
          id: string;
          title: string;
          body: string;
          sourceObjectId?: string;
          ownership: string;
          updatedAt: string;
        }>
      >;
      scanMemorySuggestions(workspaceId: string, chatId?: string): Promise<{ created: number }>;
      listMemorySuggestions(workspaceId: string): Promise<
        Array<{
          id: string;
          chatId: string;
          sourceMessageId: string;
          sourceRole: string;
          category: 'commitment' | 'decision' | 'fact' | 'person' | 'project' | 'date';
          title: string;
          body: string;
          sourceExcerpt: string;
          startOffset: number;
          endOffset: number;
          confidence: number;
          extractor: string;
          extractorVersion: string;
          status: string;
          createdAt: string;
        }>
      >;
      resolveMemorySuggestion(workspaceId: string, suggestionId: string, action: 'accept' | 'reject', title?: string, body?: string): Promise<{ acceptedObjectId?: string; kind?: 'memory' | 'commitment' }>;
      listCommitments(workspaceId: string): Promise<
        Array<{
          id: string;
          suggestionId: string;
          sourceMessageId: string;
          title: string;
          body: string;
          status: 'open' | 'completed';
          sourceExcerpt: string;
          createdAt: string;
          updatedAt: string;
          completedAt?: string;
        }>
      >;
      setCommitmentCompleted(workspaceId: string, commitmentId: string, completed: boolean): Promise<{ ok: true }>;
      composeDailyBriefing(
        workspaceId: string,
        timezone: string,
      ): Promise<{
        version: 1;
        generatedAt: string;
        timezone: string;
        localDay: string;
        items: Array<{
          id: string;
          kind: 'commitment' | 'document' | 'memory';
          title: string;
          detail: string;
          detailTruncated?: boolean;
          missingSource?: boolean;
          updatedAt: string;
          whyIncluded: string;
          freshness: 'today' | 'recent' | 'stale';
        }>;
        coverage: {
          openCommitments: number;
          documents: number;
          memories: number;
          dismissed: number;
          missingSources: number;
          omittedByLimit: number;
        };
        omissions: string[];
      }>;
      dismissBriefingItem(workspaceId: string, sourceId: string, sourceKind: 'commitment' | 'document' | 'memory', localDay: string): Promise<{ ok: true }>;
      scanRuleSuggestions(workspaceId: string): Promise<{ created: number }>;
      listRuleSuggestions(workspaceId: string): Promise<
        Array<{
          id: string;
          statement: string;
          scope: 'workspace';
          confidence: number;
          extractor: string;
          extractorVersion: string;
          status: 'pending';
          lastDryRunAt?: string;
          createdAt: string;
          sources: Array<{
            messageId: string;
            chatId: string;
            excerpt: string;
            startOffset: number;
            endOffset: number;
          }>;
        }>
      >;
      dryRunRuleSuggestion(workspaceId: string, suggestionId: string): Promise<{ matchCount: number; sourceIds: string[] }>;
      resolveRuleSuggestion(workspaceId: string, suggestionId: string, action: 'approve' | 'reject'): Promise<{ ok: true }>;
      listLearnedRules(workspaceId: string): Promise<
        Array<{
          id: string;
          suggestionId: string;
          statement: string;
          scope: 'workspace';
          version: number;
          enabled: boolean;
          priorEnabled: boolean | null;
          createdAt: string;
          updatedAt: string;
          outcomes: Array<{
            action: string;
            matchCount: number;
            version: number;
            createdAt: string;
          }>;
        }>
      >;
      setLearnedRuleEnabled(workspaceId: string, ruleId: string, enabled: boolean): Promise<{ ok: true }>;
      revertLearnedRule(workspaceId: string, ruleId: string): Promise<{ ok: true }>;
      createMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string): Promise<string>;
      captureMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string, sourceOwned?: boolean): Promise<string>;
      createRelationship(workspaceId: string, fromId: string, toId: string, type: string): Promise<string>;
      exportWorkspace(workspaceId: string): Promise<{ canceled: boolean; bytes?: number; integrity?: string }>;
      verifyBackup(): Promise<{
        canceled: boolean;
        status?:'passed'|'failed';fileName?:string;version?:number;exportedAt?:string;counts?:Record<string,number>;totalObjects?:number;code?:string;remediation?:string;
      }>;
      drillBackup():Promise<{canceled:boolean;status?:'passed'|'failed';fileName?:string;version?:number;exportedAt?:string;counts?:Record<string,number>;totalObjects?:number;code?:string;remediation?:string;drill?:{databaseIntegrity:'ok';foreignKeyViolations:0;missingFiles:0;digestMismatches:0;searchDifference:0;countsMatch:true;temporaryDataRemoved:true}}>;
      restoreWorkspace(): Promise<{
        canceled: boolean;
        workspace?: WorkspaceSummary;
      }>;
      diagnostics(workspaceId: string): Promise<DiagnosticsReport>;
      rebuildSearch(workspaceId: string): Promise<{ ok: true }>;
      exportDiagnostics(workspaceId: string): Promise<{ canceled: boolean }>;
      toolGatewayCapabilities():Promise<{version:1;tools:Array<{name:string;version:string;effect:string}>;localClis:Array<{name:string;available:boolean;executable?:string;authentication:'existing-local-identity'}>;browser:{available:boolean;backend:string;version:string;profiles:string[];reason:string};web:{fetchAvailable:boolean;searchKeyConfigured:boolean;searchProvider:string;reason:string};remoteProviders:{available:boolean;reason:string};crossDevice:{available:boolean;reason:string}}>;
      setWebSearchKey(apiKey:string):Promise<{keyConfigured:boolean}>;
      removeWebSearchKey():Promise<{keyConfigured:boolean}>;
      updateWebTools(workspaceId:string,value:{webFetchEnabled:boolean;webSearchEnabled:boolean}):Promise<{webFetchEnabled:boolean;webSearchEnabled:boolean}>;
      toolGatewaySettings(workspaceId:string):Promise<{stopped:boolean;denyPatterns:string[];suppressCommit:boolean;suppressPush:boolean;browserProfileMode:'existing'|'isolated';browserProfileName:string;browserAllowedDomains:string[];webFetchEnabled:boolean;webSearchEnabled:boolean;updatedAt:string}>;
      browserDiscovery():Promise<Array<{id:'brave'|'chrome'|'edge'|'firefox';label:string;family:'chromium'|'firefox';installed:boolean;selectable:boolean;profiles:Array<{id:string;label:string}>;reason:string}>>;
      importBrowserProfile(workspaceId:string,browserId:string,profileId:string):Promise<{settings:Awaited<ReturnType<Window['waypoint']['toolGatewaySettings']>>;profile:{browserId:string;profileId:string;bytes:number;files:number;warning:string}}>;
      removeBrowserProfile(workspaceId:string):Promise<{removed:true;settings:Awaited<ReturnType<Window['waypoint']['toolGatewaySettings']>>}>;
      inAppBrowserStatus(workspaceId:string):Promise<{workspaceId:string;url:string;title:string;loading:boolean;error?:string;canGoBack:boolean;canGoForward:boolean;profile:'Waypoint isolated';open:boolean}>;
      openInAppBrowser(workspaceId:string,url:string,bounds:{x:number;y:number;width:number;height:number}):Promise<Awaited<ReturnType<Window['waypoint']['inAppBrowserStatus']>>>;
      updateInAppBrowserBounds(workspaceId:string,bounds:{x:number;y:number;width:number;height:number}):Promise<{updated:true}>;
      navigateInAppBrowser(workspaceId:string,command:'back'|'forward'|'reload'|'stop'):Promise<Awaited<ReturnType<Window['waypoint']['inAppBrowserStatus']>>>;
      closeInAppBrowser(workspaceId:string):Promise<{closed:true}>;clearInAppBrowser(workspaceId:string):Promise<{cleared:true}>;
      hideInAppBrowser(workspaceId:string):Promise<{hidden:true}>;
      onInAppBrowserState(listener:(event:Awaited<ReturnType<Window['waypoint']['inAppBrowserStatus']>>)=>void):()=>void;
      clearToolGatewayBrowserData(workspaceId:string):Promise<{cleared:boolean}>;
      updateToolGatewaySettings(workspaceId:string,value:{stopped:boolean;denyPatterns:string[];suppressCommit:boolean;suppressPush:boolean;browserProfileMode:'existing'|'isolated';browserProfileName:string;browserAllowedDomains:string[]}):Promise<{stopped:boolean;denyPatterns:string[];suppressCommit:boolean;suppressPush:boolean;browserProfileMode:'existing'|'isolated';browserProfileName:string;browserAllowedDomains:string[];webFetchEnabled:boolean;webSearchEnabled:boolean;updatedAt:string}>;
      crossWorkspaceRollupSettings(workspaceId:string):Promise<{personalWorkspaceId:string;personalWorkspaceName:string;standingEnabled:boolean;updatedAt:string;grants:Array<{sourceWorkspaceId:string;sourceWorkspaceName:string;family:'commitments'|'meetings'|'briefing_status';enabled:boolean;createdAt:string;updatedAt:string}>;availableSources:Array<{id:string;name:string}>}>;
      updateCrossWorkspaceRollupSettings(workspaceId:string,value:{standingEnabled:boolean;grants:Array<{sourceWorkspaceId:string;family:'commitments'|'meetings'|'briefing_status';enabled:boolean}>}):Promise<Awaited<ReturnType<Window['waypoint']['crossWorkspaceRollupSettings']>>>;
      composeCrossWorkspaceRollup(workspaceId:string,families?:Array<'commitments'|'meetings'|'briefing_status'>):Promise<{personalWorkspaceId:string;generatedAt:string;items:Array<Record<string,unknown>>;provenance:string}>;
      toolGatewayReceipts(workspaceId:string,limit?:number):Promise<Array<{id:string;workspaceId:string;origin:'ui'|'ai';tool:string;status:string;summary:string;code?:string;notification?:string;outputBytes:number;truncated:boolean;startedAt:string;finishedAt:string;durationMs:number}>>;
      toolFailures(workspaceId:string,limit?:number):Promise<Array<{id:string;tool:string;capabilityVersion:string;errorClass:string;remediation?:string;outcome:'active'|'superseded';expiresAt:string;createdAt:string;updatedAt:string;hadOverride:number}>>;
      deleteToolFailure(workspaceId:string,id:string):Promise<{deleted:boolean}>;
      openRouterStatus():Promise<{settings:{enabled:boolean;liveRequestsEnabled:boolean;strategicModel:string;everydayModel:string;fallbackProvider?:'codex'|'claude';monthlyCapMicros:number;ytdCapMicros:number;perRequestCapMicros:number;warningPercent:number};keyConfigured:boolean;capability:{state:'no_key'|'disabled'|'activation_required'|'model_required'|'ready_unverified'|'cap_reached';available:boolean;health:'not_configured'|'not_checked'|'verified'|'failed';reason:string};usage:{summary:{monthMicros:number;ytdMicros:number;remainingMonthMicros:number;remainingYtdMicros:number;warning:boolean;capReached:boolean;projectedMonthMicros:number;byProvider:Array<{provider:string;costMicros:number}>;byModel:Array<{model:string;costMicros:number}>;byWorkspace:Array<{workspaceId:string;costMicros:number}>};receipts:Array<Record<string,unknown>>}}>;
      cliModelCatalog():Promise<Array<{provider:'codex'|'claude';version?:string;source:'installed-cli';models:Array<{id:string;label:string;legacy?:boolean}>;reason:string}>>;
      chatModelPreferences(workspaceId:string):Promise<Record<'codex'|'claude',string>>;
      setChatModelPreference(workspaceId:string,provider:'codex'|'claude',model:string):Promise<Record<'codex'|'claude',string>>;
      voiceCapability():Promise<{stt:{available:boolean;provider:'sherpa-whisper';reason:string;source:'bundled';model:string};tts:{available:boolean;provider:'sherpa-kitten'|'unavailable';reason:string};rawAudioPersistence:false;cloudSpeech:false}>;
      voiceEngineStatus(workspaceId:string):Promise<{selected:'fast_local'|'full_duplex_experimental';engines:Array<{id:'fast_local'|'full_duplex_experimental';label:string;ready:boolean;reason:string;version?:string;packageBytes:number;minimumRamBytes:number;conversationOwner:'waypoint-providers'|'minicpm-o-4.5';metrics:{firstAudioMs?:number;interruptionMs?:number;turnEndMs?:number;measuredAt?:string;fixture:boolean};install:'bundled'|'managed-pack'}>}>;
      configureVoiceRuntime():Promise<{canceled:boolean;capability:Awaited<ReturnType<Window['waypoint']['voiceCapability']>>}>;
      removeVoiceRuntime():Promise<{capability:Awaited<ReturnType<Window['waypoint']['voiceCapability']>>}>;
      transcribeVoice(workspaceId:string,chatId:string,mode:'push_to_talk'|'hands_free',audio:Uint8Array):Promise<{text:string;provider:'sherpa-whisper'}>;
      speakVoice(workspaceId:string,chatId:string,turnId:number,text:string):Promise<{speaking:true}>;
      stopVoice(workspaceId:string,chatId:string):Promise<{stopped:true}>;
      voicePlaybackComplete(workspaceId:string,chatId:string,turnId:number):Promise<{completed:boolean}>;
      voicePlaybackStopped(workspaceId:string,chatId:string,turnId:number):Promise<{recorded:boolean}>;
      onVoiceAudioChunk(listener:(event:{workspaceId:string;chatId:string;turnId:number;index:number;sampleRate:number;samples:Float32Array})=>void):()=>void;
      onVoiceAudioEnd(listener:(event:{workspaceId:string;chatId:string;turnId:number})=>void):()=>void;
      onVoiceAudioStop(listener:(event:{workspaceId:string;chatId:string;turnId:number})=>void):()=>void;
      voicePreferences(workspaceId:string):Promise<{mode:'push_to_talk'|'hands_free';microphoneId:string;outputVoice:'system';engine:'fast_local'|'full_duplex_experimental'}>;
      updateVoicePreferences(workspaceId:string,value:{mode:'push_to_talk'|'hands_free';microphoneId:string;outputVoice:'system';engine:'fast_local'|'full_duplex_experimental'}):Promise<{mode:'push_to_talk'|'hands_free';microphoneId:string;outputVoice:'system';engine:'fast_local'|'full_duplex_experimental'}>;
      onVoiceSpeechState(listener:(event:{workspaceId:string;chatId:string;turnId:number;result:'completed'|'canceled'|'failed'})=>void):()=>void;
      setOpenRouterKey(apiKey:string):Promise<{keyConfigured:true}>;
      removeOpenRouterKey():Promise<{keyConfigured:false}>;
      updateOpenRouterSettings(value:{enabled:boolean;liveRequestsEnabled:boolean;strategicModel:string;everydayModel:string;fallbackProvider?:'codex'|'claude';monthlyCapMicros:number;ytdCapMicros:number;perRequestCapMicros:number;warningPercent:number}):Promise<{enabled:boolean;liveRequestsEnabled:boolean;strategicModel:string;everydayModel:string;fallbackProvider?:'codex'|'claude';monthlyCapMicros:number;ytdCapMicros:number;perRequestCapMicros:number;warningPercent:number}>;
      runOpenRouterChat(value:{workspaceId:string;chatId:string;sourceMessageId:string;prompt:string;role:'strategic'|'everyday';attachmentIds:string[]}):Promise<{runId?:string;status?:'running';model?:string;fallbackProvider?:'codex'|'claude';reason?:string}>;
      cancelOpenRouterRun(workspaceId:string,runId:string):Promise<{canceled:boolean}>;
      executeTool(request:{version:1;workspaceId:string;origin?:'ui';tool:'workspace.list_files'|'workspace.read_file'|'workspace.search'|'workspace.write_file'|'terminal.run'|'local_cli.run'|'web.search'|'web.fetch'|'agent_browser.run'|'waypoint.command';arguments:Record<string,unknown>}):Promise<{runId:string;result?:unknown}>;
      cancelTool(workspaceId:string,runId:string):Promise<{canceled:boolean}>;
      onToolProgress(listener:(event:unknown)=>void):()=>void;
    };
  }
}
export {};
