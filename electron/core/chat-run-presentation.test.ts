import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { responseNoticeAfterRuns, runsForSourceMessage, uniqueChatRuns, uniqueExecutionEvents } from '../../src/chat-run-presentation.js';

describe('chat execution presentation', () => {
  it('deduplicates persisted runs and structured events without losing their first readable receipt', () => {
    const run = { id: 'run-1', sourceMessageId: 'user-1', status: 'completed', events: [
      { sequence: 1, type: 'tool', text: 'read safely' },
      { sequence: 1, type: 'tool', text: 'duplicate transport delivery' },
      { sequence: 2, type: 'terminal', text: 'completed' },
    ] };
    expect(uniqueChatRuns([run, { ...run }])).toEqual([run]);
    expect(uniqueExecutionEvents(run)).toEqual([run.events[0], run.events[2]]);
  });

  it('associates execution history with its source turn so the assistant reply can render below it', () => {
    const runs = uniqueChatRuns([
      { id: 'older', sourceMessageId: 'user-0', status: 'completed' },
      { id: 'current', sourceMessageId: 'user-1', assistantMessageId: 'assistant-1', status: 'completed' },
    ]);
    expect(runsForSourceMessage(runs, 'user-1').map((run) => run.id)).toEqual(['current']);
  });

  it.each(['completed', 'failed', 'canceled', 'timed_out'])('clears a response notice on terminal %s', (status) => {
    expect(responseNoticeAfterRuns('codex is responding…', [{ id: 'run', status }])).toBe('');
  });

  it('retains a response notice only while the exact refreshed chat still has active work', () => {
    expect(responseNoticeAfterRuns('claude is responding…', [{ id: 'run', status: 'running' }])).toBe('claude is responding…');
    expect(responseNoticeAfterRuns('Preferences saved.', [{ id: 'run', status: 'completed' }])).toBe('Preferences saved.');
  });

  it('renders source-associated history before the following reply and keeps header actions grouped accessibly', () => {
    const source = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../../src/chat-header-actions.css', import.meta.url), 'utf8');
    expect(source).toContain("message.role==='user'&&runsForSourceMessage(chatRuns,message.id).map(executionHistory)");
    expect(source).not.toContain('{chatRuns.map((value)');
    expect(source).toContain('className="chat-header-actions" role="group" aria-label="Chat actions"');
    expect(source).toContain('aria-label="Delegate task"');
    expect(source).toContain('aria-label="Open knowledge"');
    expect(styles).toContain('gap: 7px');
    expect(styles).toContain('margin-left: auto');
  });
});
