import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { accessSync, constants, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { WorkspaceStore } from './core/store.js'
import { LocalOllamaEmbeddings } from './core/ollama.js'
import { CliWorkbench } from './core/ai-workbench.js'
import { detectCli } from '../spikes/cli-capabilities.js'
import { deleteWithExecutionCancellation, startDurableChild } from './core/execution-lifecycle.js'
import { readBackup, writeAtomicBackup } from './core/backup.js'
import { exportDiagnosticsReport, runDiagnostics } from './core/diagnostics.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
let store: WorkspaceStore
let trustedSenderId: number | undefined
let trustedRendererUrl: string | undefined
const embeddings = new LocalOllamaEmbeddings()
const workbench = new CliWorkbench()

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

async function collectDiagnostics(workspaceId:string) {
  const local=store.localDiagnostics(workspaceId),capabilities=await Promise.all([detectCli('codex'),detectCli('claude')])
  return runDiagnostics({
    database:async()=>({schemaVersion:local.schemaVersion,expectedSchemaVersion:local.expectedSchemaVersion,integrity:local.integrity,foreignKeyViolations:local.foreignKeyViolations}),
    storage:async()=>{const stats=statfsSync(app.getPath('userData'));let writable=true;try{accessSync(app.getPath('userData'),constants.W_OK)}catch{writable=false}return {freeBytes:Number(stats.bavail)*Number(stats.bsize),minimumFreeBytes:512*1024*1024,writable}},
    attachments:async()=>({missingFiles:local.missingFiles,orphanFiles:local.orphanFiles,digestMismatches:local.digestMismatches}),
    search:async()=>({indexedObjects:local.indexedObjects,expectedObjects:local.expectedObjects}), embeddings:()=>embeddings.status(),
    cli:async(provider)=>{const state=capabilities.find((candidate)=>candidate.name===provider);return {configured:Boolean(state?.executable),available:Boolean(state?.available),version:state?.version}},
    sync:async()=>({configured:false,pending:0,conflicts:0,activePeers:0}),
  })
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
    const value = input as Record<string, unknown>, kind = text(value.kind, 'object kind', 20),workspaceId=text(value.workspaceId, 'workspace ID', 64),objectId=text(value.objectId, 'object ID', 64)
    if (!['document','chat','memory'].includes(kind)) throw new Error('Invalid deletable object kind')
    deleteWithExecutionCancellation(store,workbench,workspaceId,kind as 'document'|'chat'|'memory',objectId)
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
  handle('waypoint:cli-capabilities', async () => Promise.all([detectCli('codex'), detectCli('claude')]))
  handle('waypoint:list-security-profiles', (_event,input:unknown)=>store.listSecurityProfiles(text((input as Record<string,unknown>).workspaceId,'workspace ID',64)))
  handle('waypoint:list-executions', (_event,input:unknown)=>{const value=input as Record<string,unknown>;return store.listExecutions(text(value.workspaceId,'workspace ID',64),value.chatId?text(value.chatId,'chat ID',64):undefined)})
  handle('waypoint:run-chat', async (_event,input:unknown)=>{
    const value=input as Record<string,unknown>, workspaceId=text(value.workspaceId,'workspace ID',64), chatId=text(value.chatId,'chat ID',64)
    const cli=text(value.cli,'CLI',20); if(!['codex','claude'].includes(cli))throw new Error('Unsupported CLI')
    const prompt=text(value.prompt,'prompt',2_000_000), profileId=text(value.securityProfileId,'security profile ID',64)
    const workspace=store.listWorkspaces().find((candidate)=>candidate.id===workspaceId); if(!workspace)throw new Error('Workspace not found')
    const profile=store.listSecurityProfiles(workspaceId).find((candidate)=>candidate.id===profileId);if(!profile)throw new Error('Security profile not found')
    const runId=store.createExecution({workspaceId,chatId,cli:cli as 'codex'|'claude',model:value.model?text(value.model,'model',120):undefined,securityProfileId:profileId,prompt})
    try {
      const running=await startDurableChild({workspaceId,runId,detect:()=>detectCli(cli as 'codex'|'claude'),executionExists:(owner,id)=>store.executionExists(owner,id),spawn:(capability)=>workbench.start(runId,{cli:cli as 'codex'|'claude',prompt,workspaceRoot:profile.roots[0],profile,model:value.model?text(value.model,'model',120):undefined,executable:capability.executable,version:capability.version},(event)=>{try{store.appendExecutionEvent(runId,workspaceId,event)}catch{/* A deleted chat cancels persistence authority. */}}),markRunning:(child)=>store.startExecution(runId,workspaceId,child.executable,child.version)})
      void running.completion.then((result)=>{
        try {
          const events=store.listExecutions(workspaceId,chatId).find((run)=>run.id===runId)?.events as Array<Record<string,unknown>>|undefined
          const textEvents=(events??[]).filter((event)=>event.type==='text').map((event)=>String(event.text??''))
          const answer=(cli==='claude' ? textEvents.at(-1)??'' : textEvents.join('')).trim()
          store.finishExecution(runId,workspaceId,result,answer)
        } catch { /* Deleting the owning chat deliberately removes the run. */ }
      })
      return {runId,status:'running'}
    } catch(error) {
      try { store.failQueuedExecution(runId,workspaceId,error instanceof Error?error.message:'Unknown execution error') } catch { /* Preserve the original startup error. */ }
      throw error
    }
  })
  handle('waypoint:cancel-execution', (_event,input:unknown)=>{
    const value=input as Record<string,unknown>,workspaceId=text(value.workspaceId,'workspace ID',64),runId=text(value.runId,'execution ID',64)
    if(!store.executionExists(workspaceId,runId))throw new Error('Execution not found in workspace')
    return {canceled:workbench.cancel(runId)}
  })
  handle('waypoint:create-chat', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.createChat(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300)) })
  handle('waypoint:capture-chat', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.captureChat(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000)) })
  handle('waypoint:add-message', (_event, input: unknown) => { const value = input as Record<string, unknown>; const role = text(value.role, 'role', 20); if (!['user','assistant','system'].includes(role)) throw new Error('Invalid role'); return store.addMessage(text(value.workspaceId, 'workspace ID', 64), text(value.chatId, 'chat ID', 64), role as 'user'|'assistant'|'system', text(value.body, 'body', 2_000_000)) })
  handle('waypoint:list-memories', (_event, input: unknown) => store.listMemories(text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)))
  handle('waypoint:create-memory', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.createMemory(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000), value.sourceObjectId ? text(value.sourceObjectId, 'source ID', 64) : undefined) })
  handle('waypoint:capture-memory', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.captureMemory(text(value.workspaceId, 'workspace ID', 64), text(value.title, 'title', 300), text(value.body, 'body', 2_000_000), value.sourceObjectId ? text(value.sourceObjectId, 'source ID', 64) : undefined, value.sourceOwned === true ? 'source-owned' : 'workspace-owned') })
  handle('waypoint:create-relationship', (_event, input: unknown) => { const value = input as Record<string, unknown>; return store.createRelationship(text(value.workspaceId, 'workspace ID', 64), text(value.fromId, 'source ID', 64), text(value.toId, 'target ID', 64), text(value.type, 'relationship type', 80)) })
  handle('waypoint:export-workspace', async (_event, input: unknown) => {
    const workspaceId = text((input as Record<string, unknown>).workspaceId, 'workspace ID', 64)
    const warning = await dialog.showMessageBox({ type:'warning',buttons:['Create plaintext backup','Cancel'],defaultId:1,cancelId:1,title:'Backup privacy',message:'Waypoint backups are plaintext.',detail:'Choose a protected location. Deleting content in Waypoint does not delete backup copies.' })
    if(warning.response!==0)return {canceled:true}
    const chosen = await dialog.showSaveDialog({ title: 'Back up Waypoint workspace', defaultPath: 'waypoint-backup.json', filters: [{ name: 'Waypoint backup', extensions: ['json'] }] })
    if (chosen.canceled || !chosen.filePath) return { canceled: true }
    const result=writeAtomicBackup(chosen.filePath,store.exportWorkspace(workspaceId))
    return { canceled: false, ...result }
  })
  handle('waypoint:verify-backup', async () => {
    const chosen=await dialog.showOpenDialog({title:'Verify Waypoint backup',properties:['openFile'],filters:[{name:'Waypoint backup',extensions:['json']}]})
    if(chosen.canceled||!chosen.filePaths[0])return {canceled:true}
    const archive=readBackup(chosen.filePaths[0])
    return {canceled:false,version:archive.version,exportedAt:archive.exportedAt,integrity:archive.integrity}
  })
  handle('waypoint:restore-workspace', async () => {
    const chosen = await dialog.showOpenDialog({ title: 'Restore Waypoint backup as a new workspace', properties: ['openFile'], filters: [{ name: 'Waypoint backup', extensions: ['json'] }] })
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true }
    const archive = readBackup(chosen.filePaths[0])
    const base = path.basename(chosen.filePaths[0], '.json')
    return { canceled: false, workspace: store.restoreWorkspace(archive, `${base} restored`, app.getPath('userData')) }
  })
  handle('waypoint:diagnostics', async (_event,input:unknown) => {
    return collectDiagnostics(text((input as Record<string,unknown>).workspaceId,'workspace ID',64))
  })
  handle('waypoint:rebuild-search',(_event,input:unknown)=>{store.rebuildTextIndex(text((input as Record<string,unknown>).workspaceId,'workspace ID',64));return {ok:true}})
  handle('waypoint:export-diagnostics',async (_event,input:unknown)=>{
    const workspaceId=text((input as Record<string,unknown>).workspaceId,'workspace ID',64),payload=exportDiagnosticsReport(await collectDiagnostics(workspaceId))
    const chosen=await dialog.showSaveDialog({title:'Save local diagnostic report',defaultPath:'waypoint-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]})
    if(chosen.canceled||!chosen.filePath)return {canceled:true}
    const temporary=`${chosen.filePath}.partial-${randomUUID()}`
    try{writeFileSync(temporary,payload,{flag:'wx',mode:0o600});renameSync(temporary,chosen.filePath)}catch(error){rmSync(temporary,{force:true});throw error}
    return {canceled:false}
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
  let shutdownStarted=false
  app.on('before-quit', (event) => {
    if(shutdownStarted)return
    event.preventDefault();shutdownStarted=true
    void workbench.shutdown().finally(()=>{store?.close();app.exit(0)})
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
