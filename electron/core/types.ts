export type ObjectKind = 'document' | 'chat' | 'message' | 'memory'

export interface SourceRef { objectId: string; objectKind: ObjectKind; revisionId?: string }
export interface SearchResult extends SourceRef { title: string; excerpt: string; score: number; method: 'text' | 'semantic' }
export interface GraphNode { id: string; kind: 'document' | 'chat' | 'memory'; title: string }
export interface GraphEdge { id: string; fromId: string; toId: string; type: string }
export interface WorkspaceSummary { id: string; name: string; localPath: string; createdAt: string }
export interface ExportArchive { version: 2|3; exportedAt: string; workspace: Record<string, unknown>; objects: Record<string, unknown[]>; integrity: string }
export interface SanitizedSyncStatus {
  state: 'local_only'|'device_pending_keys'|'pending'|'conflicts'
  pending: number
  conflicts: number
  conflictVariants: number
  tombstones: number
  enrollmentAvailable: false
  connectionConfigured: false
}
