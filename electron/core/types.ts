export type ObjectKind = 'document' | 'chat' | 'message' | 'memory'

export interface SourceRef { objectId: string; objectKind: ObjectKind; revisionId?: string }
export interface SearchResult extends SourceRef { title: string; excerpt: string; score: number; method: 'text' | 'semantic' }
export interface GraphNode { id: string; kind: 'document' | 'chat' | 'message' | 'memory'; title: string }
export interface GraphEdge { id: string; fromId: string; toId: string; type: string }
export interface WorkspaceSummary { id: string; name: string; localPath: string; createdAt: string }
export interface AttachmentMetadata { id:string; workspaceId:string; ownerId:string; ownerKind:'document'|'chat'|'message'|'memory'; name:string; mediaType:string; sha256:string; bytes:number; createdAt:string }
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
export type ActivityFamily='content'|'execution'|'sync'|'rules'|'automation'|'meeting'|'lifecycle'|'maintenance'
export interface ActivityTimelineItem {id:string;category:string;family:ActivityFamily;action:string;objectId?:string;objectKind:string;objectState:'available'|'deleted'|'historical';objectTitle?:string;targetId?:string;targetKind?:'chat'|'document'|'memory'|'commitment'|'rule';details:Record<string,string|number|boolean|null>;createdAt:string}
export interface MeetingView {id:string;workspaceId:string;title:string;status:'recording'|'ready'|'failed';consentAcknowledgedAt:string;consentVersion:string;mediaType?:string;bytes:number;sha256?:string;transcript?:string;transcriptStatus:'none'|'draft'|'reviewed';speakerHandling:'uncertain';failureCode?:string;createdAt:string;endedAt?:string}
