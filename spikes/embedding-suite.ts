export const SUITE_VERSION = 'waypoint-retrieval-v2'
export interface CorpusItem { id: string; topic: string; text: string }
export interface QueryCase { id: string; expectedTopic: string; text: string }

const passages: Record<string, string[]> = {
  deletion: [
    'Deleting a document transactionally removes revisions, local vectors, extracted text, graph edges, owned attachments, and dependent queued work.',
    'A tombstone dominates stale offline edits; restoring intentionally creates a new identity rather than reviving the deleted object.',
    'Content-minimized timeline evidence may outlive erased content, but it must not duplicate the document body or raw model output.',
    'Tombstones remain until enrolled peers acknowledge them; a long-offline peer is revoked before the marker can be purged.',
  ],
  sync: [
    'Concurrent authored document bodies are preserved as separate variants and shown for reconciliation instead of silently choosing a winner.',
    'Each peer retains a durable outbox while the coordinator is unreachable, so basic local work continues offline.',
    'Device sequence and causal metadata make delivery replay and reordering idempotent across intermittently connected peers.',
    'Large attachment transfers resume from verified chunks and never replace the authoritative local file after a corrupt transfer.',
  ],
  security: [
    'Named security profiles constrain readable and writable roots, allowed executables, network policy, duration, concurrency, and secrets.',
    'The target computer reauthorizes peer execution under its own local policy; a requesting peer cannot grant broader rights.',
    'Renderer processes are sandboxed with Node disabled, while narrow main-process IPC validates privileged filesystem requests.',
    'CLI text and document prompts are untrusted data and can never authorize a tool, a new root, or a remote execution.',
  ],
  calendar: [
    'A future calendar view normalizes events from multiple accounts while retaining each account scope and explicit write authority.',
    'Calendar conflicts must show which provider owns the event before changing attendees, time, or recurrence.',
    'Read access to a calendar does not imply permission to create, reschedule, or cancel its events.',
    'Unified scheduling is deferred beyond the desktop knowledge core and cannot inflate the first release.',
  ],
  meeting: [
    'The future audio-only meeting recorder requires visible consent, local capture controls, and an explicit retention boundary.',
    'Transcripts, speaker labels, audio files, summaries, and their embeddings follow the recording lifecycle on deletion.',
    'Recording must stop cleanly when device audio fails without fabricating a complete transcript.',
    'Meeting capture is deferred until privacy, large-artifact sync, and recovery behavior are mature.',
  ],
  routing: [
    'Every AI run exposes the selected CLI and model, execution device, security profile, status, and agent lineage.',
    'A bounded coordinator can delegate discrete child tasks, but recursive delegation and invisible provider fallback are prohibited.',
    'Cancellation and timeout preserve a coherent durable chat record plus content-minimized execution provenance.',
    'Routing approval remains visible before execution and fallback decisions are recorded rather than silently substituted.',
  ],
  onboarding: [
    'Guided onboarding creates a personal workspace and explains its local path, synchronization boundary, and storage ownership.',
    'The setup flow detects Codex, Claude Code, and optional Ollama installations without invoking authenticated work automatically.',
    'A conservative security profile is created by default and advanced routing choices stay out of the first-run path.',
    'Node connection setup shows enrollment, last synchronization, pending changes, and actionable errors in product language.',
  ],
  backup: [
    'Export and restore prevent lock-in, while backup retention and disaster-recovery limits remain separately disclosed.',
    'A restore drill verifies object ownership, attachments, graph links, and index rebuilding against a representative workspace.',
    'Encrypted backups never silently become the only authoritative copy of a useful local workspace.',
    'Recovery artifacts are user-held and protected explicitly because the coordination server has no silent recovery key.',
  ],
}

export const corpus: CorpusItem[] = Object.entries(passages).flatMap(([topic, texts]) => texts.map((text, index) => ({ id: `${topic}-${index}`, topic, text })))

export const queries: QueryCase[] = [
  ['delete-vectors', 'deletion', 'Will semantic vectors and extracted text remain after I erase their source note?'],
  ['stale-resurrection', 'deletion', 'Can an old laptop bring back an item that another computer already removed?'],
  ['audit-after-delete', 'deletion', 'What evidence remains in history without retaining erased content?'],
  ['offline-edits', 'sync', 'Two computers changed the same prose with no network; which copy survives?'],
  ['relay-down', 'sync', 'Can I keep writing when the Ubuntu coordination machine is unreachable?'],
  ['corrupt-binary', 'sync', 'How is an interrupted or damaged attachment transfer recovered?'],
  ['folder-limits', 'security', 'How do I limit an agent to one directory and deny network access?'],
  ['remote-rights', 'security', 'May another computer grant itself wider permissions on this device?'],
  ['malicious-output', 'security', 'Could instructions printed by a model authorize another command?'],
  ['multi-account-events', 'calendar', 'How are appointments from different accounts shown without mixing ownership?'],
  ['calendar-write', 'calendar', 'Does viewing my schedule allow the app to cancel an event?'],
  ['calendar-scope', 'calendar', 'Is provider scheduling included in the first desktop release?'],
  ['recording-permission', 'meeting', 'What must happen before microphone audio is captured?'],
  ['transcript-delete', 'meeting', 'Does removing a recording also remove its summary and speaker transcript?'],
  ['capture-failure', 'meeting', 'What happens if audio input dies halfway through the session?'],
  ['which-device', 'routing', 'Where can I see which computer and model performed the task?'],
  ['child-agents', 'routing', 'Can assistants delegate forever without showing their task tree?'],
  ['interrupted-run', 'routing', 'Is a chat still understandable after I cancel generation?'],
  ['data-location', 'onboarding', 'During first run, how do I learn where my workspace files live?'],
  ['cli-detection', 'onboarding', 'Does setup check my coding assistants without starting a paid task?'],
  ['safe-default', 'onboarding', 'What permissions does a new user receive before customizing policies?'],
  ['lock-in', 'backup', 'Can I take my knowledge elsewhere if I stop using the application?'],
  ['restore-drill', 'backup', 'How do we know a saved workspace can actually be recovered?'],
  ['recovery-key', 'backup', 'Can the relay server secretly recover my encrypted content?'],
].map(([id, expectedTopic, text]) => ({ id, expectedTopic, text }))
