import type { ActivityFamily, ActivityTimelineItem, AttachmentMetadata, FixturePlaybookView, GraphEdge, GraphNode, MeetingView, SanitizedSyncStatus, SearchResult, WorkspaceSummary } from '../electron/core/types';
import type { DiagnosticsReport } from '../electron/core/diagnostics';

declare global {
  interface Window {
    waypoint: {
      bootstrap(): Promise<{ workspaces: WorkspaceSummary[] }>;
      createWorkspace(name: string): Promise<WorkspaceSummary>;
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
      }>;
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
      readMeetingAudio(workspaceId: string, meetingId: string): Promise<{ mediaType: string; audio: Uint8Array }>;
      exportMeetingAudio(workspaceId: string, meetingId: string): Promise<{ canceled: boolean }>;
      meetingTranscriptionCapability(): Promise<{
        available: false;
        provider: string;
        reason: string;
      }>;
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
    };
  }
}
export {};
