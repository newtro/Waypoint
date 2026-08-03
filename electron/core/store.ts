import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ExportArchive, GraphEdge, GraphNode, ObjectKind, SearchResult, WorkspaceSummary } from './types.js'

const now = () => new Date().toISOString()
const supportedAttachmentTypes = new Set(['text/plain', 'text/markdown'])

export class WorkspaceStore {
  private readonly db: DatabaseSync
  private readonly attachmentRoot: string

  constructor(readonly databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true })
    this.attachmentRoot = path.join(path.dirname(databasePath), 'attachments')
    mkdirSync(this.attachmentRoot, { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    this.migrate()
    this.reconcileAttachmentFiles()
  }

  close(): void { this.db.close() }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT OR IGNORE INTO schema_versions VALUES (1, '${now()}');
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, local_path TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, title TEXT NOT NULL, current_revision_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, source_object_id TEXT, ownership TEXT NOT NULL DEFAULT 'workspace-owned', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS relationships(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workspace_id,from_id,to_id,type));
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, owner_id TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL, sha256 TEXT NOT NULL, relative_path TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS embeddings(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, object_id TEXT NOT NULL, object_kind TEXT NOT NULL, revision_id TEXT, provider TEXT NOT NULL, provider_version TEXT NOT NULL, model TEXT NOT NULL, model_digest TEXT NOT NULL, dimensions INTEGER NOT NULL, chunking_digest TEXT NOT NULL, vector_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, category TEXT NOT NULL, action TEXT NOT NULL, object_id TEXT, object_kind TEXT, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones(object_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, object_kind TEXT NOT NULL, deleted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queued_work(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, context_object_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(workspace_id UNINDEXED, object_id UNINDEXED, object_kind UNINDEXED, revision_id UNINDEXED, title, body);
    `)
    const memoryColumns = this.db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>
    if (!memoryColumns.some((column) => column.name === 'ownership')) this.db.exec("ALTER TABLE memories ADD COLUMN ownership TEXT NOT NULL DEFAULT 'workspace-owned'")
    const ftsColumns = this.db.prepare('PRAGMA table_info(search_fts)').all() as Array<{ name: string }>
    if (!ftsColumns.some((column) => column.name === 'workspace_id')) {
      this.db.exec('DROP TABLE search_fts; CREATE VIRTUAL TABLE search_fts USING fts5(workspace_id UNINDEXED, object_id UNINDEXED, object_kind UNINDEXED, revision_id UNINDEXED, title, body);')
      this.db.exec(`
        INSERT INTO search_fts SELECT d.workspace_id,d.id,'document',r.id,d.title,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id;
        INSERT INTO search_fts SELECT c.workspace_id,m.id,'message',NULL,c.title,m.body FROM messages m JOIN chats c ON c.id=m.chat_id;
        INSERT INTO search_fts SELECT workspace_id,id,'memory',NULL,title,body FROM memories;
        INSERT OR IGNORE INTO schema_versions VALUES (2, '${now()}');
      `)
    }
    this.db.prepare('INSERT OR IGNORE INTO schema_versions VALUES (?,?)').run(2, now())
    this.db.prepare('INSERT OR IGNORE INTO schema_versions VALUES (?,?)').run(3, now())
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = operation(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  createWorkspace(name: string, localPath: string): WorkspaceSummary {
    if (!name.trim() || !path.isAbsolute(localPath)) throw new Error('Workspace name and absolute local path are required')
    const workspace = { id: randomUUID(), name: name.trim(), localPath: path.resolve(localPath), createdAt: now() }
    this.transaction(() => {
      this.db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspace.id, workspace.name, workspace.localPath, workspace.createdAt)
      this.activity(workspace.id, 'workspace', 'created', workspace.id, 'workspace', { localPath: workspace.localPath })
    })
    return workspace
  }

  listWorkspaces(): WorkspaceSummary[] {
    return (this.db.prepare('SELECT id,name,local_path localPath,created_at createdAt FROM workspaces ORDER BY created_at').all() as unknown) as WorkspaceSummary[]
  }

  listDocuments(workspaceId: string): Array<{ id: string; title: string; body: string; revisionId: string; updatedAt: string }> {
    return this.db.prepare('SELECT d.id,d.title,r.body,r.id revisionId,d.updated_at updatedAt FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=? ORDER BY d.updated_at DESC').all(workspaceId) as unknown as Array<{ id: string; title: string; body: string; revisionId: string; updatedAt: string }>
  }

  listChats(workspaceId: string): Array<{ id: string; title: string; updatedAt: string; messages: Array<{ id: string; role: string; body: string; createdAt: string }> }> {
    const chats = this.db.prepare('SELECT id,title,updated_at updatedAt FROM chats WHERE workspace_id=? ORDER BY updated_at DESC').all(workspaceId) as Array<{ id: string; title: string; updatedAt: string }>
    return chats.map((chat) => ({ ...chat, messages: this.db.prepare('SELECT id,role,body,created_at createdAt FROM messages WHERE chat_id=? ORDER BY created_at').all(chat.id) as Array<{ id: string; role: string; body: string; createdAt: string }> }))
  }

  listMemories(workspaceId: string): Array<{ id: string; title: string; body: string; sourceObjectId?: string; ownership: string; updatedAt: string }> {
    return this.db.prepare('SELECT id,title,body,source_object_id sourceObjectId,ownership,updated_at updatedAt FROM memories WHERE workspace_id=? ORDER BY updated_at DESC').all(workspaceId) as unknown as Array<{ id: string; title: string; body: string; sourceObjectId?: string; ownership: string; updatedAt: string }>
  }

  createDocument(workspaceId: string, title: string, body: string): { id: string; revisionId: string } {
    const id = randomUUID(), revisionId = randomUUID(), timestamp = now()
    return this.transaction(() => {
      this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(id, workspaceId, title.trim() || 'Untitled', revisionId, timestamp, timestamp)
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionId, id, body, timestamp)
      this.indexText(workspaceId, id, 'document', revisionId, title, body)
      this.activity(workspaceId, 'content', 'document.created', id, 'document', {})
      return { id, revisionId }
    })
  }

  updateDocument(workspaceId: string, documentId: string, title: string, body: string): string {
    this.assertObjectInWorkspace(workspaceId, documentId, 'document')
    const document = this.db.prepare('SELECT workspace_id FROM documents WHERE id=?').get(documentId) as { workspace_id: string } | undefined
    if (!document) throw new Error('Document not found')
    const revisionId = randomUUID(), timestamp = now()
    return this.transaction(() => {
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionId, documentId, body, timestamp)
      this.db.prepare('UPDATE documents SET title=?,current_revision_id=?,updated_at=? WHERE id=?').run(title.trim() || 'Untitled', revisionId, timestamp, documentId)
      this.db.prepare("DELETE FROM search_fts WHERE object_id=? AND object_kind='document'").run(documentId)
      this.indexText(document.workspace_id, documentId, 'document', revisionId, title, body)
      this.db.prepare('DELETE FROM embeddings WHERE object_id=?').run(documentId)
      this.activity(document.workspace_id, 'content', 'document.updated', documentId, 'document', { revisionId })
      return revisionId
    })
  }

  createChat(workspaceId: string, title: string): string {
    const id = randomUUID(), timestamp = now()
    this.transaction(() => {
      this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(id, workspaceId, title.trim() || 'New chat', timestamp, timestamp)
      this.activity(workspaceId, 'content', 'chat.created', id, 'chat', {})
    })
    return id
  }

  captureChat(workspaceId: string, title: string, body: string): string {
    const id = randomUUID(), messageId = randomUUID(), timestamp = now(), normalizedTitle = title.trim() || 'New chat'
    this.transaction(() => {
      this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(id, workspaceId, normalizedTitle, timestamp, timestamp)
      this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(messageId, id, 'user', body, timestamp)
      this.indexText(workspaceId, messageId, 'message', undefined, normalizedTitle, body)
      this.activity(workspaceId, 'content', 'chat.created', id, 'chat', {})
      this.activity(workspaceId, 'content', 'message.created', messageId, 'message', { role: 'user' })
    })
    return id
  }

  addMessage(workspaceId: string, chatId: string, role: 'user' | 'assistant' | 'system', body: string): string {
    this.assertObjectInWorkspace(workspaceId, chatId, 'chat')
    const chat = this.db.prepare('SELECT workspace_id,title FROM chats WHERE id=?').get(chatId) as { workspace_id: string; title: string } | undefined
    if (!chat) throw new Error('Chat not found')
    const id = randomUUID(), timestamp = now()
    this.transaction(() => {
      this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(id, chatId, role, body, timestamp)
      this.db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(timestamp, chatId)
      this.indexText(chat.workspace_id, id, 'message', undefined, chat.title, body)
      this.activity(chat.workspace_id, 'content', 'message.created', id, 'message', { role })
    })
    return id
  }

  createMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string, ownership: 'workspace-owned'|'source-owned' = 'workspace-owned'): string {
    if (sourceObjectId) this.assertObjectInWorkspace(workspaceId, sourceObjectId)
    if (ownership === 'source-owned' && !sourceObjectId) throw new Error('Source-owned memory requires a source')
    const id = randomUUID(), timestamp = now()
    this.transaction(() => {
      this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, title.trim() || 'Memory', body, sourceObjectId ?? null, ownership, timestamp, timestamp)
      this.indexText(workspaceId, id, 'memory', undefined, title, body)
      this.activity(workspaceId, 'content', 'memory.created', id, 'memory', { sourceObjectId: sourceObjectId ?? null })
    })
    return id
  }

  captureMemory(workspaceId: string, title: string, body: string, sourceObjectId?: string, ownership: 'workspace-owned'|'source-owned' = 'workspace-owned'): string {
    if (sourceObjectId) this.assertObjectInWorkspace(workspaceId, sourceObjectId)
    if (ownership === 'source-owned' && !sourceObjectId) throw new Error('Source-owned memory requires a source')
    const id = randomUUID(), timestamp = now(), normalizedTitle = title.trim() || 'Memory'
    this.transaction(() => {
      this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, normalizedTitle, body, sourceObjectId ?? null, ownership, timestamp, timestamp)
      this.indexText(workspaceId, id, 'memory', undefined, normalizedTitle, body)
      this.activity(workspaceId, 'content', 'memory.created', id, 'memory', { sourceObjectId: sourceObjectId ?? null })
      if (sourceObjectId) {
        const relationshipId = randomUUID()
        this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId, workspaceId, sourceObjectId, id, 'supports', timestamp)
        this.activity(workspaceId, 'graph', 'relationship.created', relationshipId, 'relationship', { fromId: sourceObjectId, toId: id, type: 'supports' })
      }
    })
    return id
  }

  createRelationship(workspaceId: string, fromId: string, toId: string, type: string): string {
    this.assertObjectInWorkspace(workspaceId, fromId)
    this.assertObjectInWorkspace(workspaceId, toId)
    const id = randomUUID()
    this.transaction(() => {
      this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(id, workspaceId, fromId, toId, type, now())
      this.activity(workspaceId, 'graph', 'relationship.created', id, 'relationship', { fromId, toId, type })
    })
    return id
  }

  addAttachment(workspaceId: string, ownerId: string, name: string, mediaType: string, sourcePath: string): string {
    if (!supportedAttachmentTypes.has(mediaType)) throw new Error(`Unsupported attachment type: ${mediaType}`)
    this.assertObjectInWorkspace(workspaceId, ownerId)
    const bytes = readFileSync(sourcePath)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const id = randomUUID(), relativePath = `${id}-${path.basename(name)}`
    copyFileSync(sourcePath, path.join(this.attachmentRoot, relativePath))
    try {
      this.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)').run(id, workspaceId, ownerId, path.basename(name), mediaType, sha256, relativePath, now())
    } catch (error) { rmSync(path.join(this.attachmentRoot, relativePath), { force: true }); throw error }
    return id
  }

  searchText(workspaceId: string, query: string, limit = 20): SearchResult[] {
    if (!query.trim()) return []
    const expression = query.trim().split(/\s+/).map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ')
    const rows = this.db.prepare('SELECT object_id,object_kind,revision_id,title,snippet(search_fts,5,\'\',\'\',\'…\',16) excerpt,bm25(search_fts) rank FROM search_fts WHERE search_fts MATCH ? AND workspace_id=? ORDER BY rank LIMIT ?').all(expression, workspaceId, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({ objectId: String(row.object_id), objectKind: row.object_kind as ObjectKind, revisionId: row.revision_id ? String(row.revision_id) : undefined, title: String(row.title), excerpt: String(row.excerpt), score: -Number(row.rank), method: 'text' }))
  }

  indexEmbedding(workspaceId: string, source: { objectId: string; objectKind: ObjectKind; revisionId?: string }, vector: number[], provenance: { provider: string; providerVersion: string; model: string; modelDigest: string; chunkingDigest: string }): void {
    this.assertObjectInWorkspace(workspaceId, source.objectId)
    if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) throw new Error('Valid embedding vector required')
    this.transaction(() => {
      this.db.prepare('DELETE FROM embeddings WHERE workspace_id=? AND object_id=?').run(workspaceId, source.objectId)
      this.db.prepare('INSERT INTO embeddings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, source.objectId, source.objectKind, source.revisionId ?? null, provenance.provider, provenance.providerVersion, provenance.model, provenance.modelDigest, vector.length, provenance.chunkingDigest, JSON.stringify(vector), now())
    })
  }

  semanticSearch(workspaceId: string, queryVector: number[], provenance: { provider: string; providerVersion: string; model: string; modelDigest: string; chunkingDigest: string }, limit = 20): SearchResult[] {
    const rows = this.db.prepare('SELECT * FROM embeddings WHERE workspace_id=? AND provider=? AND provider_version=? AND model=? AND model_digest=? AND chunking_digest=?').all(workspaceId, provenance.provider, provenance.providerVersion, provenance.model, provenance.modelDigest, provenance.chunkingDigest) as Array<Record<string, unknown>>
    return rows.map((row) => {
      const vector = JSON.parse(String(row.vector_json)) as number[]
      const score = cosine(queryVector, vector)
      const source = this.sourceTitle(String(row.object_id), String(row.object_kind) as ObjectKind)
      return { objectId: String(row.object_id), objectKind: row.object_kind as ObjectKind, revisionId: row.revision_id ? String(row.revision_id) : undefined, title: source.title, excerpt: source.excerpt, score, method: 'semantic' as const }
    }).filter((result) => Number.isFinite(result.score)).sort((a, b) => b.score - a.score).slice(0, limit)
  }

  graph(workspaceId: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const edges = this.db.prepare('SELECT id,from_id fromId,to_id toId,type FROM relationships WHERE workspace_id=?').all(workspaceId) as unknown as GraphEdge[]
    const ids = new Set(edges.flatMap((edge) => [edge.fromId, edge.toId]))
    const nodes = [...ids].map((id) => this.graphNode(id)).filter((node): node is GraphNode => Boolean(node))
    const surviving = new Set(nodes.map((node) => node.id))
    return { nodes, edges: edges.filter((edge) => surviving.has(edge.fromId) && surviving.has(edge.toId)) }
  }

  deleteObject(workspaceId: string, objectKind: 'document' | 'chat' | 'memory', objectId: string): void {
    const stagedFiles: Array<{ source: string; staged: string }> = []
    try { this.transaction(() => {
      this.assertObjectInWorkspace(workspaceId, objectId, objectKind)
      const ownedIds = objectKind === 'chat'
        ? [objectId, ...(this.db.prepare('SELECT id FROM messages WHERE chat_id=?').all(objectId) as Array<{ id: string }>).map((message) => message.id)]
        : [objectId]
      for (;;) {
        const placeholders = ownedIds.map(() => '?').join(',')
        const dependents = this.db.prepare(`SELECT id FROM memories WHERE ownership='source-owned' AND source_object_id IN (${placeholders})`).all(...ownedIds) as Array<{ id: string }>
        const additions = dependents.map((row) => row.id).filter((id) => !ownedIds.includes(id))
        if (!additions.length) break
        ownedIds.push(...additions)
      }
      const placeholders = ownedIds.map(() => '?').join(',')
      const attachmentRows = this.db.prepare(`SELECT relative_path FROM attachments WHERE owner_id IN (${placeholders})`).all(...ownedIds) as Array<{ relative_path: string }>
      for (const attachment of attachmentRows) {
        const source = path.join(this.attachmentRoot, attachment.relative_path), staged = `${source}.deleting-${randomUUID()}`
        renameSync(source, staged); stagedFiles.push({ source, staged })
      }
      this.db.prepare(`DELETE FROM relationships WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).run(...ownedIds, ...ownedIds)
      this.db.prepare(`DELETE FROM embeddings WHERE object_id IN (${placeholders})`).run(...ownedIds)
      this.db.prepare(`DELETE FROM queued_work WHERE context_object_id IN (${placeholders})`).run(...ownedIds)
      this.db.prepare(`DELETE FROM search_fts WHERE object_id IN (${placeholders})`).run(...ownedIds)
      this.db.prepare(`DELETE FROM attachments WHERE owner_id IN (${placeholders})`).run(...ownedIds)
      const dependentMemoryIds = ownedIds.filter((id) => id !== objectId && this.objectWorkspace(id, 'memory') === workspaceId)
      this.db.prepare(`UPDATE memories SET source_object_id=NULL WHERE ownership='workspace-owned' AND source_object_id IN (${placeholders})`).run(...ownedIds)
      if (dependentMemoryIds.length) this.db.prepare(`DELETE FROM memories WHERE id IN (${dependentMemoryIds.map(() => '?').join(',')})`).run(...dependentMemoryIds)
      this.db.prepare(`DELETE FROM ${objectKind === 'document' ? 'documents' : objectKind === 'chat' ? 'chats' : 'memories'} WHERE id=?`).run(objectId)
      for (const dependentId of dependentMemoryIds) { this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(dependentId, workspaceId, 'memory', now()); this.activity(workspaceId, 'lifecycle', 'deleted', dependentId, 'memory', {}) }
      this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(objectId, workspaceId, objectKind, now())
      this.activity(workspaceId, 'lifecycle', 'deleted', objectId, objectKind, {})
    }) } catch (error) {
      for (const file of stagedFiles.reverse()) renameSync(file.staged, file.source)
      throw error
    }
    for (const file of stagedFiles) rmSync(file.staged, { force: true })
  }

  listActivity(workspaceId: string): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT id,category,action,object_id objectId,object_kind objectKind,metadata_json metadata,created_at createdAt FROM activities WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId) as Array<Record<string, unknown>>
  }

  exportWorkspace(workspaceId: string): ExportArchive {
    const workspace = this.db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId) as Record<string, unknown> | undefined
    if (!workspace) throw new Error('Workspace not found')
    const tables = ['documents','revisions','chats','messages','memories','relationships','attachments','activities','tombstones']
    const objects: Record<string, unknown[]> = {}
    for (const table of tables) objects[table] = this.rowsForWorkspace(table, workspaceId)
    objects.attachments = (objects.attachments ?? []).map((value) => {
      const row = value as Record<string, unknown>
      return { ...row, data_base64: readFileSync(path.join(this.attachmentRoot, String(row.relative_path))).toString('base64') }
    })
    const archive = { version: 2 as const, exportedAt: now(), workspace, objects }
    return { ...archive, integrity: archiveIntegrity(archive) }
  }

  restoreWorkspace(archive: ExportArchive, newName: string, newLocalPath: string): WorkspaceSummary {
    if (archive.version !== 2) throw new Error('Unsupported archive version')
    if (!archive.objects || !archive.workspace || archive.integrity !== archiveIntegrity({ version: archive.version, exportedAt: archive.exportedAt, workspace: archive.workspace, objects: archive.objects })) throw new Error('Archive integrity check failed')
    if (!newName.trim() || !path.isAbsolute(newLocalPath)) throw new Error('Workspace name and absolute local path are required')
    const workspace = { id: randomUUID(), name: newName.trim(), localPath: path.resolve(newLocalPath), createdAt: now() }
    const writtenFiles: string[] = []
    try { this.transaction(() => {
      this.db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspace.id, workspace.name, workspace.localPath, workspace.createdAt)
      const idMap = new Map<string, string>()
      for (const table of ['documents','chats','memories'] as const) {
        for (const row of archive.objects[table] ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID())
      }
      for (const row of archive.objects.messages ?? []) idMap.set(String((row as Record<string, unknown>).id), randomUUID())
      for (const row of archive.objects.tombstones ?? []) idMap.set(String((row as Record<string, unknown>).object_id), randomUUID())
      for (const rowValue of archive.objects.documents ?? []) {
        const row = rowValue as Record<string, unknown>, id = idMap.get(String(row.id))!
        const revisions = (archive.objects.revisions ?? []).filter((candidate) => String((candidate as Record<string, unknown>).document_id) === String(row.id)) as Array<Record<string, unknown>>
        const revisionMap = new Map(revisions.map((revision) => [String(revision.id), randomUUID()]))
        for (const [oldId, newId] of revisionMap) idMap.set(oldId, newId)
        const currentRevisionId = revisionMap.get(String(row.current_revision_id)) ?? revisionMap.values().next().value ?? randomUUID()
        this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(id, workspace.id, String(row.title), currentRevisionId, String(row.created_at), String(row.updated_at))
        if (revisions.length === 0) this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(currentRevisionId, id, '', workspace.createdAt)
        for (const revision of revisions) this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revisionMap.get(String(revision.id))!, id, String(revision.body), String(revision.created_at))
        const current = revisions.find((revision) => String(revision.id) === String(row.current_revision_id))
        this.indexText(workspace.id, id, 'document', currentRevisionId, String(row.title), String(current?.body ?? ''))
      }
      for (const rowValue of archive.objects.chats ?? []) {
        const row = rowValue as Record<string, unknown>, id = idMap.get(String(row.id))!
        this.db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(id, workspace.id, String(row.title), String(row.created_at), String(row.updated_at))
        for (const messageValue of archive.objects.messages ?? []) {
          const message = messageValue as Record<string, unknown>
          if (String(message.chat_id) !== String(row.id)) continue
          const messageId = idMap.get(String(message.id))!
          this.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(messageId, id, String(message.role), String(message.body), String(message.created_at))
          this.indexText(workspace.id, messageId, 'message', undefined, String(row.title), String(message.body))
        }
      }
      for (const rowValue of archive.objects.memories ?? []) {
        const row = rowValue as Record<string, unknown>, id = idMap.get(String(row.id))!
        this.db.prepare('INSERT INTO memories(id,workspace_id,title,body,source_object_id,ownership,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, workspace.id, String(row.title), String(row.body), row.source_object_id ? idMap.get(String(row.source_object_id)) ?? null : null, String(row.ownership ?? 'workspace-owned'), String(row.created_at), String(row.updated_at))
        this.indexText(workspace.id, id, 'memory', undefined, String(row.title), String(row.body))
      }
      for (const edgeValue of archive.objects.relationships ?? []) {
        const edge = edgeValue as Record<string, unknown>, from = idMap.get(String(edge.from_id)), to = idMap.get(String(edge.to_id))
        if (from && to) { const relationshipId = randomUUID(); idMap.set(String(edge.id), relationshipId); this.db.prepare('INSERT INTO relationships VALUES (?,?,?,?,?,?)').run(relationshipId, workspace.id, from, to, String(edge.type), String(edge.created_at)) }
      }
      for (const attachmentValue of archive.objects.attachments ?? []) {
        const attachment = attachmentValue as Record<string, unknown>
        const owner = idMap.get(String(attachment.owner_id))
        if (!owner || !supportedAttachmentTypes.has(String(attachment.media_type))) continue
        const bytes = Buffer.from(String(attachment.data_base64 ?? ''), 'base64')
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        if (sha256 !== String(attachment.sha256)) throw new Error('Attachment archive integrity check failed')
        const id = randomUUID(), relativePath = `${id}-${path.basename(String(attachment.name))}`
        const targetPath = path.join(this.attachmentRoot, relativePath)
        writeFileSync(targetPath, bytes, { flag: 'wx' })
        writtenFiles.push(targetPath)
        this.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)').run(id, workspace.id, owner, path.basename(String(attachment.name)), String(attachment.media_type), sha256, relativePath, String(attachment.created_at))
      }
      for (const tombstoneValue of archive.objects.tombstones ?? []) {
        const tombstone = tombstoneValue as Record<string, unknown>, mapped = idMap.get(String(tombstone.object_id))!
        this.db.prepare('INSERT INTO tombstones VALUES (?,?,?,?)').run(mapped, workspace.id, String(tombstone.object_kind), String(tombstone.deleted_at))
      }
      for (const activityValue of archive.objects.activities ?? []) {
        const archived = activityValue as Record<string, unknown>, oldObjectId = archived.object_id ? String(archived.object_id) : undefined
        const mappedObjectId = oldObjectId === String((archive.workspace as Record<string, unknown>).id) ? workspace.id : oldObjectId ? idMap.get(oldObjectId) ?? null : null
        const metadata = remapArchiveValue(JSON.parse(String(archived.metadata_json ?? '{}')) as unknown, idMap, String((archive.workspace as Record<string, unknown>).id), workspace.id)
        this.db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspace.id, String(archived.category), String(archived.action), mappedObjectId, archived.object_kind ? String(archived.object_kind) : null, JSON.stringify(metadata), String(archived.created_at))
      }
      this.activity(workspace.id, 'lifecycle', 'workspace.restored', workspace.id, 'workspace', { archiveVersion: archive.version })
    }) } catch (error) {
      for (const file of writtenFiles) rmSync(file, { force: true })
      throw error
    }
    return workspace
  }

  counts(): Record<string, number> {
    const tables = ['workspaces','documents','revisions','chats','messages','memories','relationships','attachments','embeddings','activities','tombstones','queued_work','search_fts']
    return Object.fromEntries(tables.map((table) => [table, Number((this.db.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: number }).count)]))
  }

  private activity(workspaceId: string, category: string, action: string, objectId: string, objectKind: string, metadata: Record<string, unknown>): void {
    this.db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, category, action, objectId, objectKind, JSON.stringify(metadata), now())
  }
  private indexText(workspaceId: string, objectId: string, kind: ObjectKind, revisionId: string | undefined, title: string, body: string): void { this.db.prepare('INSERT INTO search_fts VALUES (?,?,?,?,?,?)').run(workspaceId, objectId, kind, revisionId ?? null, title, body) }
  private objectWorkspace(id: string, expectedKind?: string): string | undefined {
    const sources = expectedKind === 'document' ? [['documents', 'workspace_id']] : expectedKind === 'chat' ? [['chats', 'workspace_id']] : expectedKind === 'memory' ? [['memories', 'workspace_id']] : [
      ['documents', 'workspace_id'], ['chats', 'workspace_id'], ['memories', 'workspace_id'],
    ]
    for (const [table, column] of sources) {
      const row = this.db.prepare(`SELECT ${column} workspace_id FROM ${table} WHERE id=?`).get(id) as { workspace_id: string } | undefined
      if (row) return row.workspace_id
    }
    if (!expectedKind || expectedKind === 'message') {
      const row = this.db.prepare('SELECT c.workspace_id FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as { workspace_id: string } | undefined
      if (row) return row.workspace_id
    }
    return undefined
  }
  private assertObjectInWorkspace(workspaceId: string, id: string, expectedKind?: string): void {
    if (this.objectWorkspace(id, expectedKind) !== workspaceId) throw new Error('Object not found in workspace')
  }
  private sourceTitle(id: string, kind: ObjectKind): { title: string; excerpt: string } {
    if (kind === 'document') { const row = this.db.prepare('SELECT d.title,r.body FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.id=?').get(id) as { title: string; body: string }; return { title: row.title, excerpt: row.body.slice(0, 180) } }
    if (kind === 'memory') { const row = this.db.prepare('SELECT title,body FROM memories WHERE id=?').get(id) as { title: string; body: string }; return { title: row.title, excerpt: row.body.slice(0, 180) } }
    if (kind === 'message') { const row = this.db.prepare('SELECT c.title,m.body FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=?').get(id) as { title: string; body: string }; return { title: row.title, excerpt: row.body.slice(0, 180) } }
    const row = this.db.prepare('SELECT title FROM chats WHERE id=?').get(id) as { title: string }; return { title: row.title, excerpt: '' }
  }
  private graphNode(id: string): GraphNode | undefined {
    for (const [table, kind] of [['documents','document'],['chats','chat'],['memories','memory']] as const) {
      const row = this.db.prepare(`SELECT title FROM ${table} WHERE id=?`).get(id) as { title: string } | undefined
      if (row) return { id, kind, title: row.title }
    }
    return undefined
  }
  private rowsForWorkspace(table: string, workspaceId: string): unknown[] {
    if (table === 'revisions') return this.db.prepare('SELECT r.* FROM revisions r JOIN documents d ON d.id=r.document_id WHERE d.workspace_id=?').all(workspaceId)
    if (table === 'messages') return this.db.prepare('SELECT m.* FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.workspace_id=?').all(workspaceId)
    return this.db.prepare(`SELECT * FROM ${table} WHERE workspace_id=?`).all(workspaceId)
  }

  private reconcileAttachmentFiles(): void {
    const referenced = new Set((this.db.prepare('SELECT relative_path FROM attachments').all() as Array<{ relative_path: string }>).map((row) => row.relative_path))
    const suffix = /\.deleting-[0-9a-f-]{36}$/
    for (const entry of readdirSync(this.attachmentRoot)) {
      const fullPath = path.join(this.attachmentRoot, entry), original = entry.replace(suffix, '')
      if (suffix.test(entry)) {
        if (referenced.has(original) && !existsSync(path.join(this.attachmentRoot, original))) renameSync(fullPath, path.join(this.attachmentRoot, original))
        else rmSync(fullPath, { force: true })
      } else if (!referenced.has(entry)) rmSync(fullPath, { force: true })
    }
  }
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.NaN
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) { dot += left[index] * right[index]; leftMagnitude += left[index] ** 2; rightMagnitude += right[index] ** 2 }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : Number.NaN
}

function archiveIntegrity(archive: Omit<ExportArchive, 'integrity'>): string {
  return createHash('sha256').update(JSON.stringify(archive)).digest('hex')
}

function remapArchiveValue(value: unknown, idMap: Map<string, string>, oldWorkspaceId: string, newWorkspaceId: string): unknown {
  if (typeof value === 'string') return value === oldWorkspaceId ? newWorkspaceId : idMap.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => remapArchiveValue(item, idMap, oldWorkspaceId, newWorkspaceId))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapArchiveValue(item, idMap, oldWorkspaceId, newWorkspaceId)]))
  return value
}
