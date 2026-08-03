import type { GraphEdge, GraphNode, SanitizedSyncStatus, SearchResult, WorkspaceSummary } from '../electron/core/types'
import type { DiagnosticsReport } from '../electron/core/diagnostics'

declare global {
  interface Window {
    waypoint: {
      bootstrap(): Promise<{ workspaces: WorkspaceSummary[] }>
      createWorkspace(name: string): Promise<WorkspaceSummary>
      createDocument(workspaceId: string, title: string, body: string): Promise<{ id: string; revisionId: string }>
      updateDocument(workspaceId: string, objectId: string, title: string, body: string): Promise<string>
      listDocuments(workspaceId: string): Promise<Array<{ id: string; title: string; body: string; revisionId: string; updatedAt: string }>>
      syncStatus(workspaceId:string):Promise<SanitizedSyncStatus>
      searchText(workspaceId: string, query: string): Promise<SearchResult[]>
      searchSemantic(workspaceId: string, query: string): Promise<SearchResult[]>
      indexDocument(workspaceId: string, objectId: string): Promise<{ ok: true; model: string; modelDigest: string }>
      deleteDocument(workspaceId: string, objectId: string): Promise<{ ok: true }>
      deleteObject(workspaceId: string, kind: 'document'|'chat'|'memory', objectId: string): Promise<{ ok: true }>
      attachDocument(workspaceId: string, objectId: string): Promise<{ canceled: boolean; attachmentId?: string }>
      graph(workspaceId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>
      activity(workspaceId: string): Promise<Array<Record<string, unknown>>>
      listChats(workspaceId: string): Promise<Array<{ id: string; title: string; updatedAt: string; messages: Array<{ id: string; role: string; body: string; createdAt: string }> }>>
      cliCapabilities(): Promise<Array<{name:'codex'|'claude';available:boolean;executable?:string;version?:string;error?:string;compatible?:boolean;compatibilityError?:string}>>
      listSecurityProfiles(workspaceId:string): Promise<Array<{id:string;name:string;roots:string[];filesystem:'read-only'|'workspace-write';network:'provider-only'|'disabled';tools:string[];approval:'always'|'on-write';maxDurationMs:number;maxConcurrency:number;peerEligible:boolean;secretNames:string[]}>>
      listExecutions(workspaceId:string,chatId?:string): Promise<Array<Record<string,unknown>>>
      runChat(workspaceId:string,chatId:string,cli:'codex'|'claude',securityProfileId:string,prompt:string,model?:string,parentExecutionId?:string): Promise<{runId:string;status:'running'}>
      cancelExecution(runId:string): Promise<{canceled:boolean}>
      createChat(workspaceId: string, title: string): Promise<string>
      captureChat(workspaceId: string, title: string, body: string): Promise<string>
      addMessage(workspaceId: string, chatId: string, role: 'user' | 'assistant' | 'system', body: string): Promise<string>
      listMemories(workspaceId: string): Promise<Array<{ id: string; title: string; body: string; sourceObjectId?: string; ownership: string; updatedAt: string }>>
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
