import { FormEvent, StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { GraphEdge, GraphNode, SanitizedSyncStatus, SearchResult, WorkspaceSummary } from '../electron/core/types'
import type { DiagnosticsReport } from '../electron/core/diagnostics'
import { reconcileSelectedChatId, RefreshGate } from './chat-selection'
import { failureAdvice, type ExecutionRunView } from './ai-workbench-ui'
import { closesEditedDocumentAfterDelete, DebouncedAutosave, type AutosaveState } from './autosave'
import { onboardingReadiness, type ReadinessItem } from './readiness'
import './styles.css'

type Document = {
  id: string
  title: string
  body: string
  revisionId: string
  updatedAt: string
}
type Chat = Awaited<ReturnType<Window['waypoint']['listChats']>>[number]
type Memory = Awaited<ReturnType<Window['waypoint']['listMemories']>>[number]
type DocumentDraft={workspaceId:string;id:string;title:string;body:string}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSummary>()
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [documents, setDocuments] = useState<Document[]>([]),
    [chats, setChats] = useState<Chat[]>([]),
    [memories, setMemories] = useState<Memory[]>([])
  const [graph, setGraph] = useState<{
      nodes: GraphNode[]
      edges: GraphEdge[]
    }>({ nodes: [], edges: [] }),
    [activity, setActivity] = useState<Array<Record<string, unknown>>>([])
  const [results, setResults] = useState<SearchResult[]>([]),
    [editing, setEditing] = useState<Document>(),
    [panel, setPanel] = useState<'notes' | 'chats' | 'memory' | 'activity' | 'health' | 'settings'>('notes')
  const [selectedChatId, setSelectedChatId] = useState<string>(),
    [creatingChat, setCreatingChat] = useState(false)
  const [delegationParentId, setDelegationParentId] = useState<string>()
  const [profiles, setProfiles] = useState<Awaited<ReturnType<Window['waypoint']['listSecurityProfiles']>>>([]),
    [runs, setRuns] = useState<Array<Record<string, unknown>>>([]),
    [capabilities, setCapabilities] = useState<Awaited<ReturnType<Window['waypoint']['cliCapabilities']>>>([])
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport>(),
    [checking, setChecking] = useState(false)
  const [syncStatus,setSyncStatus]=useState<SanitizedSyncStatus>(),[readiness,setReadiness]=useState<{workspace:WorkspaceSummary;items:ReadinessItem[]}>()
  const [autosaveState,setAutosaveState]=useState<AutosaveState>('idle'),[autosaveError,setAutosaveError]=useState('')
  const autosaveRef=useRef<DebouncedAutosave<DocumentDraft>|undefined>(undefined)
  if(!autosaveRef.current)autosaveRef.current=new DebouncedAutosave((draft)=>JSON.stringify(draft),900,(state,nextError)=>{setAutosaveState(state);setAutosaveError(nextError??'')})
  const refreshGate = useRef(new RefreshGate())

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason))
  }
  async function refresh(next = workspace) {
    if (!next) return
    const refreshToken = refreshGate.current.begin()
    const [nextDocuments, nextChats, nextMemories, nextGraph, nextActivity, nextProfiles, nextRuns,nextSync] = await Promise.all([window.waypoint.listDocuments(next.id), window.waypoint.listChats(next.id), window.waypoint.listMemories(next.id), window.waypoint.graph(next.id), window.waypoint.activity(next.id), window.waypoint.listSecurityProfiles(next.id), window.waypoint.listExecutions(next.id),window.waypoint.syncStatus(next.id)])
    if (!refreshGate.current.isCurrent(refreshToken)) return
    setDocuments(nextDocuments)
    setChats(nextChats)
    setSelectedChatId((current) => reconcileSelectedChatId(nextChats, current))
    setMemories(nextMemories)
    setGraph(nextGraph)
    setActivity(nextActivity)
    setProfiles(nextProfiles)
    setRuns(nextRuns)
    setSyncStatus(nextSync)
  }
  async function selectWorkspace(next: WorkspaceSummary) {
    if(!(await flushEditorBeforeNavigation()))return
    setWorkspace(next)
    setResults([])
    setDocuments([])
    setChats([])
    setSelectedChatId(undefined)
    setCreatingChat(false)
    setMemories([])
    setGraph({ nodes: [], edges: [] })
    setActivity([])
    setSyncStatus(undefined);autosaveRef.current?.cancel();setEditing(undefined)
    await refresh(next)
  }
  useEffect(() => {
    void Promise.all([window.waypoint.bootstrap(), window.waypoint.cliCapabilities()])
      .then(async ([{ workspaces: available }, nextCapabilities]) => {
        setCapabilities(nextCapabilities)
        setWorkspaces(available)
        if (available[0]) await selectWorkspace(available[0])
      })
      .catch(showError) // Initial bootstrap intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!runs.some((run) => run.status === 'running')) return
    const timer = window.setInterval(() => void refresh().catch(showError), 750)
    return () => window.clearInterval(timer)
  })
  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    try {
      const created = await window.waypoint.createWorkspace(String(new FormData(event.currentTarget).get('name') ?? ''))
      setWorkspaces((current) => [...current, created])
      const [capabilityResult,syncResult]=await Promise.allSettled([window.waypoint.cliCapabilities(),window.waypoint.syncStatus(created.id)])
      const nextCapabilities=capabilityResult.status==='fulfilled'?capabilityResult.value:[],nextSync=syncResult.status==='fulfilled'?syncResult.value:{state:'local_only' as const,pending:0,conflicts:0,conflictVariants:0,tombstones:0,enrollmentAvailable:false as const,connectionConfigured:false as const}
      setCapabilities(nextCapabilities);setReadiness({workspace:created,items:onboardingReadiness(nextCapabilities,nextSync)})
      if(capabilityResult.status==='rejected'||syncResult.status==='rejected')setError('Workspace created, but one local readiness check could not complete. You can continue and retry from Health.')
    } catch (reason) {
      showError(reason)
    }
  }
  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace) return
    const form = event.currentTarget,
      data = new FormData(form),
      title = String(data.get('title') ?? ''),
      body = String(data.get('body') ?? '')
    try {
      if (editing) await autosaveRef.current!.flush({workspaceId:workspace.id,id:editing.id,title,body},persistDocumentDraft)
      else await window.waypoint.createDocument(workspace.id, title, body)
      autosaveRef.current?.cancel()
      setEditing(undefined)
      form.reset()
      await refresh()
    } catch (reason) {
      showError(reason)
    }
  }
  async function persistDocumentDraft(draft:DocumentDraft){
    const revisionId=await window.waypoint.updateDocument(draft.workspaceId,draft.id,draft.title,draft.body)
    const updatedAt=new Date().toISOString()
    setEditing((current)=>current?.id===draft.id?{...current,title:draft.title,body:draft.body,revisionId,updatedAt}:current)
    setDocuments((current)=>current.map((document)=>document.id===draft.id?{...document,title:draft.title,body:draft.body,revisionId,updatedAt}:document))
  }
  async function flushEditorBeforeNavigation():Promise<boolean>{
    if(!editing||!autosaveRef.current?.hasPending())return true
    try{await autosaveRef.current.flushPending(persistDocumentDraft);return true}catch(reason){showError(reason);return false}
  }
  async function beginEditing(document:Document|undefined){
    if(editing?.id!==document?.id&&!(await flushEditorBeforeNavigation()))return
    autosaveRef.current?.cancel();setEditing(document)
    if(document&&workspace)autosaveRef.current?.markPersisted({workspaceId:workspace.id,id:document.id,title:document.title,body:document.body})
  }
  async function closeEditor(){if(!(await flushEditorBeforeNavigation()))return;autosaveRef.current?.cancel();setEditing(undefined)}
  async function changePanel(next:typeof panel){if(next!==panel&&!(await flushEditorBeforeNavigation()))return;setPanel(next)}
  function scheduleDocumentAutosave(form:HTMLFormElement){
    if(!workspace||!editing)return
    const data=new FormData(form),draft={workspaceId:workspace.id,id:editing.id,title:String(data.get('title')??''),body:String(data.get('body')??'')}
    if(!draft.title.trim()||!draft.body)return
    autosaveRef.current?.schedule(draft,persistDocumentDraft)
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace) return
    const data = new FormData(event.currentTarget),
      query = String(data.get('query') ?? '')
    try {
      setResults(data.get('method') === 'semantic' ? await window.waypoint.searchSemantic(workspace.id, query) : await window.waypoint.searchText(workspace.id, query))
    } catch (reason) {
      showError(reason)
    }
  }
  async function remove(kind: 'document' | 'chat' | 'memory', objectId: string) {
    if (!workspace || !window.confirm(`Delete this ${kind} and all owned local data? This cannot be undone.`)) return
    try {
      if(kind==='document'&&editing?.id===objectId&&!(await flushEditorBeforeNavigation()))return
      await window.waypoint.deleteObject(workspace.id, kind, objectId)
      if(closesEditedDocumentAfterDelete(kind,objectId,editing?.id))setEditing(undefined)
      setResults((current) => current.filter((result) => result.objectId !== objectId))
      await refresh()
    } catch (reason) {
      showError(reason)
    }
  }
  async function index(documentId: string) {
    if (!workspace) return
    try {
      const result = await window.waypoint.indexDocument(workspace.id, documentId)
      setNotice(`Semantic index updated with ${result.model}.`)
      await refresh()
    } catch (reason) {
      showError(reason)
    }
  }
  async function attach(documentId: string) {
    if (!workspace) return
    try {
      const result = await window.waypoint.attachDocument(workspace.id, documentId)
      if (!result.canceled) setNotice('Attachment copied into the local workspace store.')
    } catch (reason) {
      showError(reason)
    }
  }
  async function addChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace) return
    const form = event.currentTarget,
      data = new FormData(form)
    try {
      const chatId = await window.waypoint.captureChat(workspace.id, String(data.get('title') ?? ''), String(data.get('body') ?? ''))
      form.reset()
      await refresh()
      setSelectedChatId(chatId)
      setCreatingChat(false)
    } catch (reason) {
      showError(reason)
    }
  }
  async function addToChat(event: FormEvent<HTMLFormElement>, chatId: string) {
    event.preventDefault()
    if (!workspace) return
    const form = event.currentTarget,
      body = String(new FormData(form).get('body') ?? '')
    try {
      await window.waypoint.addMessage(workspace.id, chatId, 'user', body)
      form.reset()
      await refresh()
    } catch (reason) {
      showError(reason)
    }
  }
  async function runChat(event: FormEvent<HTMLFormElement>, chatId: string) {
    event.preventDefault()
    if (!workspace) return
    const form = event.currentTarget,
      data = new FormData(form),
      prompt = String(data.get('prompt') ?? ''),
      cli = String(data.get('cli') ?? 'codex') as 'codex' | 'claude',
      profileId = String(data.get('profile') ?? ''),
      model = String(data.get('model') ?? '') || undefined,
      parentExecutionId = String(data.get('parentExecutionId') ?? '') || undefined
    try {
      await window.waypoint.addMessage(workspace.id, chatId, 'user', prompt)
      const started = await window.waypoint.runChat(workspace.id, chatId, cli, profileId, prompt, model, parentExecutionId)
      form.reset()
      setDelegationParentId(undefined)
      setNotice(`Started ${cli} run ${started.runId.slice(0, 8)}.`)
      await refresh()
    } catch (reason) {
      showError(reason)
    }
  }
  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace) return
    const form = event.currentTarget,
      data = new FormData(form)
    try {
      const source = String(data.get('source') ?? '') || undefined
      await window.waypoint.captureMemory(workspace.id, String(data.get('title') ?? ''), String(data.get('body') ?? ''), source, data.get('sourceOwned') === 'on')
      form.reset()
      await refresh()
    } catch (reason) {
      showError(reason)
    }
  }
  async function exportWorkspace() {
    if (!workspace) return
    try {
      const result = await window.waypoint.exportWorkspace(workspace.id)
      if (!result.canceled) setNotice(`Plaintext backup verified and saved (${Math.ceil((result.bytes ?? 0) / 1024)} KiB).`)
    } catch (reason) {
      showError(reason)
    }
  }
  async function verifyBackup() {
    try {
      const result = await window.waypoint.verifyBackup()
      if (!result.canceled) setNotice(`Backup v${result.version} passed its corruption check.`)
    } catch (reason) {
      showError(reason)
    }
  }
  async function restoreWorkspace() {
    try {
      const result = await window.waypoint.restoreWorkspace()
      if (result.workspace) {
        setWorkspaces((current) => [...current, result.workspace!])
        await selectWorkspace(result.workspace)
      }
    } catch (reason) {
      showError(reason)
    }
  }
  async function runHealth() {
    if (!workspace) return
    setChecking(true)
    setError('')
    try {
      setDiagnostics(await window.waypoint.diagnostics(workspace.id))
    } catch (reason) {
      showError(reason)
    } finally {
      setChecking(false)
    }
  }
  async function rebuildSearch() {
    if (!workspace) return
    try {
      await window.waypoint.rebuildSearch(workspace.id)
      setNotice('Text index rebuilt from canonical workspace content.')
      await runHealth()
    } catch (reason) {
      showError(reason)
    }
  }
  async function saveDiagnostics() {
    if (!workspace) return
    try {
      const result = await window.waypoint.exportDiagnostics(workspace.id)
      if (!result.canceled) setNotice('Content-minimized diagnostic report saved locally.')
    } catch (reason) {
      showError(reason)
    }
  }

  if(!workspace&&readiness)return <main className="onboarding readiness" aria-labelledby="readiness-title"><p className="eyebrow">LOCAL READINESS</p><h1 id="readiness-title">Workspace<br/>created.</h1><p className="summary">Waypoint checked the local tools needed for the next step. No node was contacted, no device was enrolled, and no keys were created.</p><div className="readiness-grid">{readiness.items.map((item)=><article key={item.id} className={`readiness-item ${item.status}`}><span>{item.status}</span><h2>{item.id}</h2><p>{item.summary}</p></article>)}</div><aside className="backup-warning"><strong>Sync setup is separate.</strong> The native, Docker-free coordinator path is documented in <code>docs/COORDINATOR_UBUNTU.md</code>. Device identity, keys, enrollment, TLS, and a real node still require explicit setup.</aside><button autoFocus onClick={()=>{const created=readiness.workspace;setReadiness(undefined);void selectWorkspace(created)}}>Open workspace</button></main>
  if (!workspace)
    return (
      <main className="onboarding">
        <p className="eyebrow">WAYPOINT · LOCAL FIRST</p>
        <h1>
          Start where
          <br />
          you are.
        </h1>
        <p className="summary">Create a personal workspace stored on this computer. Peer sync is off until you explicitly configure and enroll devices; AI work leaves only through the signed-in CLI you select.</p>
        <form onSubmit={createWorkspace}>
          <label>
            Workspace name
            <input name="name" required maxLength={120} placeholder="Personal" autoFocus />
          </label>
          <button>Create local workspace</button>
        </form>
        <p className="privacy-note">Telemetry and automatic crash uploads are not included. Local diagnostics never send a report.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
    )
  const displayItems = results.length
    ? results.map((result) => ({
        id: result.objectId,
        kind: result.objectKind,
        title: result.title,
        body: result.excerpt,
        detail: `${result.method} · ${result.objectKind} ${result.objectId.slice(0, 8)}${result.revisionId ? ` · revision ${result.revisionId.slice(0, 8)}` : ''}`,
      }))
    : documents.map((document) => ({
        id: document.id,
        kind: 'document' as const,
        title: document.title,
        body: document.body.slice(0, 180),
        detail: `revision ${document.revisionId.slice(0, 8)}`,
      }))
  const selectedChat = chats.find((chat) => chat.id === selectedChatId)
  const delegationParent = runs.find((run) => run.id === delegationParentId)
  return (
    <div className="shell">
      <header>
        <div>
          <p className="eyebrow">PERSONAL WORKSPACE</p>
          <h2>{workspace.name}</h2>
          <p className="path">Waypoint data root: {workspace.localPath}</p>
        </div>
        <div className="header-actions">
          <label className="workspace-picker">
            Workspace
            <select
              value={workspace.id}
              onChange={(event) => {
                const selected = workspaces.find((candidate) => candidate.id === event.target.value)
                if (selected) void selectWorkspace(selected)
              }}
            >
              {workspaces.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <span className="status" title="Only sanitized local sync counts are shown; no node connection is configured here.">
            Sync · {syncStatus?.state.replaceAll('_',' ')??'checking'}
          </span>
          <button className="quiet" onClick={() => void exportWorkspace()}>
            Back up
          </button>
          <button className="quiet" onClick={() => void verifyBackup()}>
            Verify backup
          </button>
          <button className="quiet" onClick={() => void restoreWorkspace()}>
            Restore drill
          </button>
        </div>
      </header>
      <nav aria-label="Workspace sections">
        {(['notes', 'chats', 'memory', 'activity', 'health','settings'] as const).map((name) => (
          <button key={name} aria-pressed={panel === name} className={panel === name ? 'active' : 'quiet'} onClick={() => void changePanel(name)}>
            {name}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {panel === 'notes' && (
        <div className="columns">
          <section className="composer">
            <h3>{editing ? 'Edit note' : 'Capture a note'}</h3>
            <form key={editing?.id ?? 'new'} onSubmit={saveDocument} onChange={(event)=>scheduleDocumentAutosave(event.currentTarget)}>
              <label>
                Title
                <input name="title" maxLength={300} required defaultValue={editing?.title} />
              </label>
              <label>
                Markdown or plain text
                <textarea name="body" rows={12} required defaultValue={editing?.body} />
              </label>
              <button>{editing ? 'Save revision' : 'Save note'}</button>
              {editing&&<span className={`autosave ${autosaveState}`} role="status" aria-live="polite">{autosaveState==='saving'?'Saving changes…':autosaveState==='saved'?'All changes saved':autosaveState==='error'?`Autosave failed: ${autosaveError}`:'Autosave ready'}</span>}
              {editing && (
                <button type="button" className="quiet" onClick={() => void closeEditor()}>
                  Close editor
                </button>
              )}
            </form>
          </section>
          <section className="library">
            <form className="search" onSubmit={search}>
              <input name="query" aria-label="Search workspace" placeholder="Search this workspace…" required />
              <select name="method" aria-label="Search method">
                <option value="text">Text</option>
                <option value="semantic">Semantic · Ollama</option>
              </select>
              <button>Search</button>
            </form>
            <h3>{results.length ? 'Search results' : 'Recent notes'}</h3>
            <div className="cards">
              {displayItems.map((item) => (
                <article key={item.id}>
                  <button
                    className="card-main"
                    onClick={() => {
                      if (item.kind === 'document') void beginEditing(documents.find((document) => document.id === item.id))
                      else void changePanel(item.kind === 'memory' ? 'memory' : 'chats')
                    }}
                  >
                    <h4>{item.title}</h4>
                    <p>{item.body}</p>
                    <small>{item.detail}</small>
                  </button>
                  {item.kind === 'document' && (
                    <div className="card-actions">
                      <button className="quiet" onClick={() => void attach(item.id)}>
                        Attach
                      </button>
                      <button className="quiet" onClick={() => void index(item.id)}>
                        Index
                      </button>
                      <button className="danger" onClick={() => void remove('document', item.id)}>
                        Delete
                      </button>
                    </div>
                  )}
                  {item.kind === 'memory' && (
                    <button className="danger" onClick={() => void remove('memory', item.id)}>
                      Delete
                    </button>
                  )}
                </article>
              ))}
              {!documents.length && !results.length && <p className="empty">Your first durable note will appear here.</p>}
            </div>
          </section>
        </div>
      )}
      {panel === 'chats' && (
        <div className="chat-layout">
          <aside className="chat-sidebar" aria-label="Chat history">
            <div className="chat-sidebar-heading">
              <div>
                <p className="eyebrow">ROUTE LOG</p>
                <h3>Chats</h3>
              </div>
              <button onClick={() => setCreatingChat(true)}>New Chat</button>
            </div>
            <div className="chat-list">
              {chats.map((chat) => {
                const selected = !creatingChat && chat.id === selectedChatId
                return (
                  <button
                    key={chat.id}
                    aria-pressed={selected}
                    className={`chat-list-item ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedChatId(chat.id)
                      setCreatingChat(false)
                    }}
                  >
                    <span>{chat.title}</span>
                    <small>{chat.messages.at(-1)?.body ?? 'No messages yet'}</small>
                  </button>
                )
              })}
              {!chats.length && <p className="empty">No saved chats yet.</p>}
            </div>
          </aside>
          <section className="chat-thread">
            {creatingChat ? (
              <div className="new-chat">
                <p className="eyebrow">NEW ROUTE</p>
                <h3>Start a chat</h3>
                <p className="empty">Name the conversation and leave its first durable message.</p>
                <form onSubmit={addChat}>
                  <label>
                    Title
                    <input name="title" required autoFocus />
                  </label>
                  <label>
                    First message
                    <textarea name="body" rows={8} required />
                  </label>
                  <div className="chat-form-actions">
                    <button>Create chat</button>
                    {chats.length > 0 && (
                      <button type="button" className="quiet" onClick={() => setCreatingChat(false)}>
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>
            ) : selectedChat ? (
              <>
                <div className="chat-thread-heading">
                  <div>
                    <p className="eyebrow">ACTIVE CHAT</p>
                    <h3>{selectedChat.title}</h3>
                  </div>
                  <button className="danger" onClick={() => void remove('chat', selectedChat.id)}>
                    Delete chat
                  </button>
                </div>
                <div className="message-stream">
                  {selectedChat.messages.map((message) => (
                    <article key={message.id} className={`message ${message.role}`}>
                      <small>{message.role}</small>
                      <p>{message.body}</p>
                    </article>
                  ))}
                </div>
                <form key={delegationParentId ?? 'root-run'} className="chat-composer" onSubmit={(event) => void runChat(event, selectedChat.id)}>
                  <p className="eyebrow">AI WORKBENCH</p>
                  {delegationParentId && (
                    <aside className="delegation-note">
                      One-child delegation from run {delegationParentId.slice(0, 8)}. The parent security profile is enforced.
                      <button type="button" className="quiet" onClick={() => setDelegationParentId(undefined)}>
                        Cancel delegation
                      </button>
                    </aside>
                  )}
                  <input type="hidden" name="parentExecutionId" value={delegationParentId ?? ''} />
                  <label>
                    Task
                    <textarea name="prompt" rows={3} required placeholder="Ask the selected signed-in CLI…" />
                  </label>
                  <div className="chat-form-actions">
                    <select name="cli" aria-label="CLI route">
                      {capabilities.map((capability) => (
                        <option key={capability.name} value={capability.name} disabled={!capability.available || capability.compatible === false}>
                          {capability.name} · {capability.available ? `${capability.version}${capability.compatible === false ? ' · incompatible' : ''}` : 'unavailable'}
                        </option>
                      ))}
                    </select>
                    <label className="model-field">
                      Model (optional)
                      <input name="model" maxLength={120} placeholder="CLI default" />
                    </label>
                    <select name="profile" aria-label="Security profile" defaultValue={delegationParent ? String(delegationParent.securityProfileId) : undefined}>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} · {profile.filesystem}
                        </option>
                      ))}
                    </select>
                    <button disabled={!capabilities.some((capability) => capability.available && capability.compatible !== false) || !profiles.length}>Run</button>
                  </div>
                  <div className="capability-notices">
                    {capabilities
                      .filter((item) => !item.available || item.compatible === false)
                      .map((item) => (
                        <p key={item.name} role="status">
                          <strong>{item.name}:</strong> {item.compatibilityError ?? item.error}
                        </p>
                      ))}
                  </div>
                </form>
                <div className="cards run-list" aria-live="polite">
                  {runs
                    .filter((run) => run.chatId === selectedChat.id)
                    .map((runValue) => {
                      const run = runValue as ExecutionRunView,
                        events = run.events ?? [],
                        hasChild = runs.some((candidate) => candidate.parentExecutionId === run.id),
                        advice = failureAdvice(run)
                      return (
                        <article key={String(run.id)} className={`run-card ${String(run.status)}`}>
                          <div>
                            <h4>
                              {String(run.cli)} · {String(run.status)}
                            </h4>
                            <dl className="route-details">
                              <div>
                                <dt>Run</dt>
                                <dd>{String(run.id).slice(0, 8)}</dd>
                              </div>
                              <div>
                                <dt>Model</dt>
                                <dd>{String(run.model ?? 'CLI default')}</dd>
                              </div>
                              <div>
                                <dt>CLI version</dt>
                                <dd>{String(run.cliVersion ?? 'detecting…')}</dd>
                              </div>
                              <div>
                                <dt>Executable</dt>
                                <dd>{String(run.executable ?? 'detecting…')}</dd>
                              </div>
                              <div>
                                <dt>Device</dt>
                                <dd>{String(run.device)}</dd>
                              </div>
                              <div>
                                <dt>Profile</dt>
                                <dd>{String(run.profileName)}</dd>
                              </div>
                              <div>
                                <dt>Lineage</dt>
                                <dd>
                                  {run.parentExecutionId ? `${String(run.parentExecutionId).slice(0, 8)} → ${String(run.id).slice(0, 8)}` : 'root'} · depth {String(run.depth)}
                                </dd>
                              </div>
                            </dl>
                            {events.length > 0 && (
                              <div className="run-events">
                                {events.slice(-20).map((event) => (
                                  <p key={`${String(run.id)}-${String(event.sequence)}`} className={`run-event ${String(event.type)}`}>
                                    <strong>
                                      {String(event.type)}
                                      {event.name ? ` · ${String(event.name)}` : ''}
                                    </strong>
                                    {event.text ? ` — ${String(event.text).slice(0, 2000)}` : ''}
                                    <small>{event.rawType ? String(event.rawType) : ''}</small>
                                  </p>
                                ))}
                              </div>
                            )}
                            {advice && (
                              <p className="run-failure" role="alert">
                                {advice}
                              </p>
                            )}
                          </div>
                          <div className="run-actions">
                            {run.status === 'running' && (
                              <button
                                className="danger"
                                onClick={async () => {
                                  await window.waypoint.cancelExecution(String(run.id))
                                  await refresh()
                                }}
                              >
                                Cancel
                              </button>
                            )}
                            {run.status === 'completed' && Number(run.depth) === 0 && !hasChild && (
                              <button className="quiet" onClick={() => setDelegationParentId(String(run.id))}>
                                Delegate one child
                              </button>
                            )}
                          </div>
                        </article>
                      )
                    })}
                </div>
                <form className="chat-composer" onSubmit={(event) => void addToChat(event, selectedChat.id)}>
                  <label>
                    Save without running
                    <textarea name="body" rows={2} required placeholder="Add a durable message only…" />
                  </label>
                  <button>Add message</button>
                </form>
              </>
            ) : (
              <div className="chat-empty">
                <p className="eyebrow">NO ACTIVE ROUTE</p>
                <h3>Start your first chat</h3>
                <p className="empty">Chats stay durable and local to this workspace.</p>
                <button onClick={() => setCreatingChat(true)}>New Chat</button>
              </div>
            )}
          </section>
        </div>
      )}
      {panel === 'memory' && (
        <div className="columns">
          <section className="composer">
            <h3>Add memory</h3>
            <form onSubmit={addMemory}>
              <label>
                Title
                <input name="title" required />
              </label>
              <label>
                Memory
                <textarea name="body" rows={7} required />
              </label>
              <label>
                Connect from note
                <select name="source">
                  <option value="">No connection</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" name="sourceOwned" />
                Delete this memory if its source is deleted
              </label>
              <button>Save memory</button>
            </form>
          </section>
          <section className="library">
            <h3>Memory graph</h3>
            <p className="empty">
              {graph.nodes.length} nodes · {graph.edges.length} relationships
            </p>
            <div className="edge-list">
              {graph.edges.map((edge) => (
                <p key={edge.id}>
                  {graph.nodes.find((node) => node.id === edge.fromId)?.title ?? 'Unknown'} <strong>{edge.type}</strong> {graph.nodes.find((node) => node.id === edge.toId)?.title ?? 'Unknown'}
                </p>
              ))}
            </div>
            <div className="cards">
              {memories.map((memory) => (
                <article key={memory.id}>
                  <div>
                    <h4>{memory.title}</h4>
                    <p>{memory.body}</p>
                    <small>
                      {memory.ownership}
                      {memory.sourceObjectId ? ` · source ${memory.sourceObjectId.slice(0, 8)}` : ''}
                    </small>
                  </div>
                  <button className="danger" onClick={() => void remove('memory', memory.id)}>
                    Delete
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
      {panel === 'activity' && (
        <section className="library full">
          <h3>Activity timeline</h3>
          <div className="cards">
            {activity.map((item) => (
              <article key={String(item.id)}>
                <div>
                  <h4>{String(item.action)}</h4>
                  <small>
                    {String(item.createdAt)} · {String(item.objectKind ?? 'workspace')} {String(item.objectId ?? '').slice(0, 8)}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {panel === 'health' && (
        <section className="library full health" aria-labelledby="health-title">
          <div className="health-heading">
            <div>
              <p className="eyebrow">LOCAL HEALTH</p>
              <h3 id="health-title">Diagnostics & recovery</h3>
            </div>
            <div className="header-actions">
              <button onClick={() => void runHealth()} disabled={checking}>
                {checking ? 'Checking…' : 'Run local checks'}
              </button>
              <button className="quiet" onClick={() => void saveDiagnostics()} disabled={!diagnostics}>
                Save redacted report
              </button>
            </div>
          </div>
          <p className="privacy-note">Checks stay on this Mac. No telemetry or crash report is uploaded. Exact local paths, content, prompts, credentials, and raw errors are excluded from saved reports.</p>
          <aside className="backup-warning">
            <strong>Backups are plaintext.</strong> Keep them in a protected location. A restored backup becomes a new workspace identity, rebuilds derived indexes, and must be enrolled again before future peer sync.
          </aside>
          {diagnostics ? (
            <div className="diagnostic-grid">
              {diagnostics.results.map((item) => (
                <article key={item.code} className={`diagnostic ${item.status}`}>
                  <span className="diagnostic-state">{item.status.replace('_', ' ')}</span>
                  <h4>{item.code}</h4>
                  <p>{item.summary}</p>
                  {item.remediation && <small>{item.remediation}</small>}
                  {item.code === 'search.consistency' && item.status !== 'pass' && (
                    <button className="quiet" onClick={() => void rebuildSearch()}>
                      Rebuild text index
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty">Run the checks to inspect the database, disk, attachments, indexes, local CLIs, optional Ollama runtime, and local sync state.</p>
          )}
        </section>
      )}
      {panel==='settings'&&<section className="library full settings" aria-labelledby="sync-settings-title"><p className="eyebrow">SETTINGS · SYNC</p><h3 id="sync-settings-title">Private peer continuity</h3><p className="privacy-note">This screen shows sanitized aggregate state only. It cannot read queued content, mutation payloads, device identifiers, keys, clocks, or encrypted envelopes.</p><div className="sync-summary" role="status" aria-live="polite"><article><small>Local state</small><strong>{syncStatus?.state.replaceAll('_',' ')??'checking'}</strong></article><article><small>Pending changes</small><strong>{syncStatus?.pending??0}</strong></article><article><small>Conflicts</small><strong>{syncStatus?.conflicts??0}</strong></article><article><small>Deletion markers</small><strong>{syncStatus?.tombstones??0}</strong></article></div><aside className="backup-warning"><strong>Setup has not been performed here.</strong> Follow <code>docs/COORDINATOR_UBUNTU.md</code> for the documented native node boundary. The current relay foundation has no public listener; real TLS, keys, device enrollment, and Windows-peer validation remain required.</aside><div className="settings-actions"><button disabled title="Key creation requires a separately approved setup flow">Create device keys · unavailable</button><button disabled title="Enrollment requires a configured trusted node and explicit user action">Enroll device · unavailable</button><button disabled={true} title="Conflict UI is not enabled until enrollment and transport integration are complete">Resolve conflicts · unavailable</button></div></section>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
