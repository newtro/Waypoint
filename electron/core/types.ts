export type ObjectKind = 'document' | 'chat' | 'message' | 'memory' | 'screen_capture';

export interface SourceRef {
  objectId: string;
  objectKind: ObjectKind;
  revisionId?: string;
}
export interface SearchResult extends SourceRef {
  title: string;
  excerpt: string;
  score: number;
  method: 'text' | 'semantic';
}
export interface GraphNode {
  id: string;
  kind: 'document' | 'chat' | 'message' | 'memory';
  title: string;
}
export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
}
export interface WorkspaceSummary {
  id: string;
  name: string;
  localPath: string;
  executionRoot?: string;
  createdAt: string;
}
export interface AttachmentMetadata {
  id: string;
  workspaceId: string;
  ownerId: string;
  ownerKind: 'document' | 'chat' | 'message' | 'memory' | 'activity_snapshot' | 'screen_capture';
  name: string;
  mediaType: string;
  sha256: string;
  bytes: number;
  syncEligible: boolean;
  localOnlyReason?:
    | 'transport_file_size'
    | 'transport_owner_count'
    | 'transport_workspace_count';
  createdAt: string;
}
export interface ExportArchive {
  version: 2 | 3;
  exportedAt: string;
  workspace: Record<string, unknown>;
  objects: Record<string, unknown[]>;
  integrity: string;
}
export interface SanitizedSyncStatus {
  state: 'local_only' | 'device_pending_keys' | 'pending' | 'conflicts';
  pending: number;
  conflicts: number;
  conflictVariants: number;
  tombstones: number;
  localOnlyAttachments: number;
  enrollmentAvailable: false;
  connectionConfigured: false;
}
export type ActivityFamily = 'content' | 'execution' | 'sync' | 'rules' | 'automation' | 'meeting' | 'lifecycle' | 'maintenance';
export interface ActivityTimelineItem {
  id: string;
  category: string;
  family: ActivityFamily;
  action: string;
  objectId?: string;
  objectKind: string;
  objectState: 'available' | 'deleted' | 'historical';
  objectTitle?: string;
  targetId?: string;
  targetKind?: 'chat' | 'document' | 'memory' | 'commitment' | 'rule';
  details: Record<string, string | number | boolean | null>;
  createdAt: string;
}
export interface ActivitySnapshotView {
  id: string;
  capturedAt: string;
  deviceId: string;
  displayId: string;
  appBundleId: string;
  appProcess: string;
  appTitle?: string;
  expiresAt: string;
  bytes: number;
  synced: boolean;
}
export interface MeetingView {
  id: string;
  workspaceId: string;
  title: string;
  status: 'recording' | 'ready' | 'failed';
  consentAcknowledgedAt: string;
  consentVersion: string;
  mediaType?: string;
  bytes: number;
  sha256?: string;
  transcript?: string;
  transcriptStatus: 'none' | 'draft' | 'reviewed';
  speakerHandling: 'uncertain';
  failureCode?: string;
  createdAt: string;
  endedAt?: string;
}
export interface FixturePlaybookView {
  id: string;
  workspaceId: string;
  title: string;
  version: number;
  definition: {
    schemaVersion: 1;
    connector: { provider: string; version: string };
    steps: Array<{ id: string; operation: string }>;
  };
  permission: {
    provider: string;
    version: string;
    accountId: string;
    tenantId: string;
    scopes: readonly string[];
  };
  status: 'paused' | 'killed';
  timezone: string;
  hour: number;
  minute: number;
  nextOccurrence: string;
  lastDryRunAt?: string;
  createdAt: string;
  updatedAt: string;
  runs: Array<{
    id: string;
    status: 'dry_run' | 'completed' | 'retrying' | 'dead_letter';
    attempt: number;
    inputCount: number;
    outputCount: number;
    proposedEffects: 0;
    createdAt: string;
    finishedAt?: string;
  }>;
}
