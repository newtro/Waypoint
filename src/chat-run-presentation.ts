import type { ExecutionRunView } from './ai-workbench-ui.js';

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const RESPONSE_NOTICE = /(?:is responding|responding within|stopping the (?:hosted request|local cli))/i;

export function uniqueChatRuns(runs: ExecutionRunView[]): ExecutionRunView[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    const id = String(run.id ?? '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function uniqueExecutionEvents(run: ExecutionRunView): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return (run.events ?? []).filter((event) => {
    const sequence = event.sequence;
    const key = sequence !== undefined && sequence !== null
      ? `sequence:${String(sequence)}`
      : `content:${String(event.type ?? '')}:${String(event.name ?? '')}:${String(event.text ?? '')}:${String(event.createdAt ?? '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function responseNoticeAfterRuns(notice: string, runs: ExecutionRunView[]): string {
  if (!RESPONSE_NOTICE.test(notice)) return notice;
  return runs.some((run) => ACTIVE_STATUSES.has(String(run.status))) ? notice : '';
}

export function runsForSourceMessage(runs: ExecutionRunView[], messageId: string): ExecutionRunView[] {
  return runs.filter((run) => String(run.sourceMessageId ?? '') === messageId);
}
