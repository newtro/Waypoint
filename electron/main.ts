import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { WorkspaceStore } from './core/store.js'
import { LocalOllamaEmbeddings } from './core/ollama.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
let store: WorkspaceStore
let trustedSenderId: number | undefined
let trustedRendererUrl: string | undefined
const embeddings = new LocalOllamaEmbeddings()

function handle(channel: string, listener: (event: IpcMainInvokeEvent, input: unknown) => unknown): void {
  ipcMain.handle(channel, (event, input) => {
    if (event.sender.id !== trustedSenderId || event.senderFrame?.url !== trustedRendererUrl) throw new Error('Unauthorized renderer')
    return listener(event, input)
  })
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${field}`)
  return value
}

function registerIpc(): void {
  handle('waypoint:bootstrap', () => ({ workspaces: store.listWorkspaces() }))
  handle('waypoint:create-workspace', (_event, input: unknown) => {
    const name = text((input as { name?: unknown })?.name, 'workspace name', 120).trim()
    if (!name) throw new Error('Workspace name is required')
    return store.createWorkspace(name, app.getPath('userData'))
  })
  handle('waypoint:create-document', (_event, input: unknown) => {
    const value = input as Record<string, unknown>
    return store.createDocument(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000))
  })
  handle('waypoint:update-document', (_event, input: unknown) => {
    const value = input as Record<string, unknown>
    return store.updateDocument(text(value.workspaceId, 'workspace ID', 64), text(value.objectId, 'document ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000))
  })
  handle('waypoint:list-documents', (_event, input: unknown) => store.listDocuments(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)))
  handle('waypoint:search-text', (_event, input: unknown) => {
    const value = input as Record<string, unknown>
    const workspaceId = text(value.workspaceId, 'workspace ID', 64)
    return store.searchText(workspaceId, text(value.query, 'query', 500))
  })
  handle('waypoint:search-semantic', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>, workspaceId = text(value.workspaceId, 'workspace ID', 64)
    const embedded = await embeddings.embed([text(value.query, 'query', 2_000)])
    return store.semanticSearch(workspaceId, embedded.vectors[0], { provider: embeddings.provider, providerVersion: embeddings.providerVersion, model: embeddings.model, modelDigest: embedded.modelDigest, chunkingDigest: 'whole-document-v1' })
  })
  handle('waypoint:index-document', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>, workspaceId = text(value.workspaceId, 'workspace ID', 64), objectId = text(value.objectId, 'document ID', 64)
    const document = store.listDocuments(workspaceId).find((candidate) => candidate.id === objectId)
    if (!document) throw new Error('Document not found in workspace')
    const embedded = await embeddings.embed([`${document.title}\n\n${document.body}`])
    store.indexEmbedding(workspaceId, { objectId, objectKind: 'document', revisionId: document.revisionId }, embedded.vectors[0], {
      provider: embeddings.provider, providerVersion: embeddings.providerVersion, model: embeddings.model, modelDigest: embedded.modelDigest, chunkingDigest: 'whole-document-v1',
    })
    return { ok: true, model: embeddings.model, modelDigest: embedded.modelDigest }
  })
  handle('waypoint:delete-document', (_event, input: unknown) => {
    const value = input as Record<string, unknown>
    store.deleteObject(text(value.workspaceId, 'workspace ID', 64), 'document', text(value.objectId, 'document ID', 64))
    return { ok: true }
  })
  handle('waypoint:delete-object', (_event, input: unknown) => {
    const value = input as Record<string, unknown>, kind = text(value.kind, 'object kind', 20)
    if (!['document','chat','memory'].includes(kind)) throw new Error('Invalid deletable object kind')
    store.deleteObject(text(value.workspaceId, 'workspace ID', 64), kind as 'document'|'chat'|'memory', text(value.objectId, 'object ID', 64))
    return { ok: true }
  })
  handle('waypoint:attach-document', async (_event, input: unknown) => {
    const value = input as Record<string, unknown>, workspaceId = text(value.workspaceId, 'workspace ID', 64), objectId = text(value.objectId, 'document ID', 64)
    const chosen = await dialog.showOpenDialog({ title: 'Attach text to note', properties: ['openFile'], filters: [{ name: 'Text and Markdown', extensions: ['txt', 'md', 'markdown'] }] })
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true }
    const sourcePath = chosen.filePaths[0], extension = path.extname(sourcePath).toLowerCase()
    const mediaType = extension === '.md' || extension === '.markdown' ? 'text/markdown' : 'text/plain'
    return { canceled: false, attachmentId: store.addAttachment(workspaceId, objectId, path.basename(sourcePath), mediaType, sourcePath) }
  })
  handle('waypoint:graph', (_event, input: unknown) => store.graph(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)))
  handle('waypoint:activity', (_event, input: unknown) => store.listActivity(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)))
  handle('waypoint:list-chats', (_event, input: unknown) => store.listChats(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)))
  handle('waypoint:create-chat', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.createChat(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300)) })
  handle('waypoint:capture-chat', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.captureChat(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000)) })
  handle('waypoint:add-message', (_event, input: unknown) => { const value = input as Record<string, unknown>; const role = text(value.role, 'role', 20); if (!['user','assistant','system'].includes(role)) throw new Error('Invalid role'); return store.addMessage(text(value.workspaceId, 'workspace ID', 64), text(value.chatId, 'chat ID', 64), role as 'user'|'assistant'|'system', text(value.body, 'body', 2_000_000)) })
  handle('waypoint:list-memories', (_event, input: unknown) => store.listMemories(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)))
  handle('waypoint:create-memory', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.createMemory(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000), value.sourceObjectId ? text(value.sourceObjectId, 'source ID', 64) : undefined) })
  handle('waypoint:capture-memory', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.captureMemory(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000), value.sourceObjectId ? text(value.sourceObjectId, 'source ID', 64) : undefined, value.sourceOwned === true ? 'source-owned' : 'workspace-owned') })
  handle('waypoint:create-relationship', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.createRelationship(text(value.workspaceId, 'workspace ID', 64), text(value.fromId, 'source ID', 64), text(value.toId, 'target ID', 64), text(value.type, 'relationship type', 80)) })
  handle('waypoint:export-workspace', async (_event, input: unknown) => {
    const workspaceId = text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)
    const chosen = await dialog.showSaveDialog({ title: 'Export Waypoint workspace', defaultPath: 'waypoint-export.json', filters: [{ name: 'Waypoint archive', extensions: ['json'] }] })
    if (chosen.canceled || !chosen.filePath) return { canceled: true }
    const temporaryPath = `${chosen.filePath}.tmp-${randomUUID()}`
    try { writeFileSync(temporaryPath, JSON.stringify(store.exportWorkspace(workspaceId), null, 2), { flag: 'wx' }); renameSync(temporaryPath, chosen.filePath) }
    catch (error) { rmSync(temporaryPath, { force: true }); throw error }
    return { canceled: false }
  })
  handle('waypoint:restore-workspace', async () => {
    const chosen = await dialog.showOpenDialog({ title: 'Restore Waypoint workspace', properties: ['openFile'], filters: [{ name: 'Waypoint archive', extensions: ['json'] }] })
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true }
    const archive = JSON.parse(readFileSync(chosen.filePaths[0], 'utf8')) as Parameters<WorkspaceStore['restoreWorkspace']>[0]
    const base = path.basename(chosen.filePaths[0], '.json')
    return { canceled: false, workspace: store.restoreWorkspace(archive, `${base} restored`, app.getPath('userData')) }
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180, height: 760, minWidth: 840, minHeight: 620, backgroundColor: '#111b19',
    webPreferences: { preload: path.join(currentDirectory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const developmentUrl = process.env.VITE_DEV_SERVER_URL
  if (developmentUrl) { const parsed = new URL(developmentUrl); if (parsed.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('Development server must be an unauthenticated HTTP loopback URL') }
  const allowedUrl = developmentUrl ? new URL(developmentUrl).href : pathToFileURL(path.join(currentDirectory, '../../dist/index.html')).href
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => { if (target !== allowedUrl) event.preventDefault() })
  if (developmentUrl) void window.loadURL(developmentUrl)
  else void window.loadFile(path.join(currentDirectory, '../../dist/index.html'))
  trustedSenderId = window.webContents.id
  trustedRendererUrl = allowedUrl
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.whenReady().then(() => {
    store = new WorkspaceStore(path.join(app.getPath('userData'), 'waypoint.sqlite'))
    registerIpc()
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('second-instance', () => { const window = BrowserWindow.getAllWindows()[0]; if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.on('before-quit', () => store?.close())
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
