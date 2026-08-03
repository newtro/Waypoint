import type { AttachmentMetadata, GraphEdge, GraphNode, SanitizedSyncStatus, SearchResult, WorkspaceSummary } from '../electron/core/types'
import type { DiagnosticsReport } from '../electron/core/diagnostics'

declare global {
  interface Window {
    waypoint: {
      bootstrap(): Promise<{ workspaces: WorkspaceSummary[] }>
      createWorkspace(name: string): Promise<WorkspaceSummary>
      createDocument(workspaceId: string, title: string, body: string): Promise<{ id: string; revisionId: string }>
      captureMessageAsDocument(workspaceId:string,messageId:string):Promise<{id:string;revisionId:string}>
      updateDocument(workspaceId: string, objectId: string, title: string, body: string): Promise<string>
      listDocuments(workspaceId: string): Promise<Array<{ id: string; title: string; body: string; revisionId: string; updatedAt: string }>>
      syncStatus(workspaceId:string):Promise<SanitizedSyncStatus>
      desktopSyncStatus(workspaceId:string):Promise<{configured:boolean;pendingEnrollment:boolean;deviceId?:string;keyEpoch:number;rotationTargetEpoch?:number;endpoint:string}>
      initializeDesktopSync(workspaceId:string):Promise<{canceled:boolean;bootstrap?:{workspaceId:string;deviceId:string;signingPublicKey:string;encryptionPublicKey:string;endpoint:string;bootstrapRequired:true}}>
      createSyncInvitation(workspaceId:string):Promise<{token:string;expiresAt:string}>
      submitSyncEnrollment(token:string):Promise<{workspaceId:string;requestId:string;status:'pending'}>
      completeSyncEnrollment(workspaceId:string):Promise<{configured:true;deviceId:string;keyEpoch:number}>
      pendingSyncEnrollments(workspaceId:string):Promise<Array<{requestId:string;deviceId:string;createdAt:string;expiresAt:string}>>
      approveSyncEnrollment(workspaceId:string,requestId:string):Promise<{canceled:boolean;status?:'approved'}>
      syncDevices(workspaceId:string):Promise<Array<{deviceId:string;role:string;status:string;enrolledAt:string;revokedAt?:string}>>
      revokeSyncDevice(workspaceId:string,deviceId:string):Promise<{canceled:boolean;rotation?:{keyEpoch:number}}>
      resumeSyncRotation(workspaceId:string):Promise<{keyEpoch:number}>
      syncNow(workspaceId:string):Promise<{sent:number;received:number;activePeers:number}>
      searchText(workspaceId: string, query: string): Promise<SearchResult[]>
      searchSemantic(workspaceId: string, query: string): Promise<SearchResult[]>
      indexDocument(workspaceId: string, objectId: string): Promise<{ ok: true; model: string; modelDigest: string }>
      deleteDocument(workspaceId: string, objectId: string): Promise<{ ok: true }>
      deleteObject(workspaceId: string, kind: 'document'|'chat'|'memory', objectId: string): Promise<{ ok: true }>
      attachDocument(workspaceId: string, objectId: string): Promise<{ canceled: boolean; attachmentId?: string }>
      selectChatAttachments(workspaceId:string,chatId:string):Promise<{canceled:boolean;attachments:AttachmentMetadata[]}>
      listChatAttachments(workspaceId:string,chatId:string):Promise<AttachmentMetadata[]>
      deleteAttachment(workspaceId:string,attachmentId:string):Promise<{ok:true}>
      graph(workspaceId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>
      activity(workspaceId: string): Promise<Array<Record<string, unknown>>>
      listChats(workspaceId: string): Promise<Array<{ id: string; title: string; updatedAt: string; messages: Array<{ id: string; role: string; body: string; createdAt: string }> }>>
      cliCapabilities(): Promise<Array<{name:'codex'|'claude';available:boolean;executable?:string;version?:string;error?:string;compatible?:boolean;compatibilityError?:string}>>
      listSecurityProfiles(workspaceId:string): Promise<Array<{id:string;name:string;roots:string[];filesystem:'read-only'|'workspace-write';network:'provider-only'|'disabled';tools:string[];approval:'always'|'on-write';maxDurationMs:number;maxConcurrency:number;peerEligible:boolean;secretNames:string[]}>>
      listExecutions(workspaceId:string,chatId?:string): Promise<Array<Record<string,unknown>>>
      runChat(workspaceId:string,chatId:string,sourceMessageId:string,cli:'codex'|'claude',securityProfileId:string,prompt:string,model?:string,parentExecutionId?:string,attachmentIds?:string[]): Promise<{runId:string;status:'running';attachmentDelivery:{passedToCli:string[];unsupported:Array<{id:string;reason:string}>}}>
      cancelExecution(runId:string): Promise<{canceled:boolean}>
      createChat(workspaceId: string, title: string): Promise<string>
      captureChat(workspaceId: string, title: string, body: string): Promise<string>
      addMessage(workspaceId: string, chatId: string, role: 'user' | 'assistant' | 'system', body: string,attachmentIds?:string[]): Promise<string>
      listMemories(workspaceId: string): Promise<Array<{ id: string; title: string; body: string; sourceObjectId?: string; ownership: string; updatedAt: string }>>
      scanMemorySuggestions(workspaceId:string,chatId?:string):Promise<{created:number}>
      listMemorySuggestions(workspaceId:string):Promise<Array<{id:string;chatId:string;sourceMessageId:string;sourceRole:string;category:'commitment'|'decision'|'fact'|'person'|'project'|'date';title:string;body:string;sourceExcerpt:string;startOffset:number;endOffset:number;confidence:number;extractor:string;extractorVersion:string;status:string;createdAt:string}>>
      resolveMemorySuggestion(workspaceId:string,suggestionId:string,action:'accept'|'reject',title?:string,body?:string):Promise<{acceptedObjectId?:string;kind?:'memory'|'commitment'}>
      listCommitments(workspaceId:string):Promise<Array<{id:string;suggestionId:string;sourceMessageId:string;title:string;body:string;status:'open'|'completed';sourceExcerpt:string;createdAt:string;updatedAt:string;completedAt?:string}>>
      setCommitmentCompleted(workspaceId:string,commitmentId:string,completed:boolean):Promise<{ok:true}>
      composeDailyBriefing(workspaceId:string,timezone:string):Promise<{version:1;generatedAt:string;timezone:string;localDay:string;items:Array<{id:string;kind:'commitment'|'document'|'memory';title:string;detail:string;detailTruncated?:boolean;missingSource?:boolean;updatedAt:string;whyIncluded:string;freshness:'today'|'recent'|'stale'}>;coverage:{openCommitments:number;documents:number;memories:number;dismissed:number;missingSources:number;omittedByLimit:number};omissions:string[]}>
      dismissBriefingItem(workspaceId:string,sourceId:string,sourceKind:'commitment'|'document'|'memory',localDay:string):Promise<{ok:true}>
      createMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string): Promise<string>
      captureMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string, sourceOwned?: boolean): Promise<string>
      createRelationship(workspaceId: string, fromId: string, toId: string, type: string): Promise<string>
      exportWorkspace(workspaceId: string): Promise<{ canceled: boolean; bytes?:number; integrity?:string }>
      verifyBackup(): Promise<{canceled:boolean;version?:number;exportedAt?:string;integrity?:string}>
      restoreWorkspace(): Promise<{ canceled: boolean; workspace?: WorkspaceSummary }>
      diagnostics(workspaceId:string):Promise<DiagnosticsReport>
      rebuildSearch(workspaceId:string):Promise<{ok:true}>
      exportDiagnostics(workspaceId:string):Promise<{canceled:boolean}>
    }
  }
}
export {}
