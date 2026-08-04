import { describe, expect, it, vi } from 'vitest';
import { cancelLateVoiceRun } from './voice-run-cancellation.js';

describe('late voice run cancellation', () => {
  it('cancels a just-returned hosted run through the hosted API', async () => {
    const api = {
      cancelOpenRouterRun: vi.fn(async () => ({ canceled: true })),
      cancelExecution: vi.fn(async () => undefined),
    };
    await cancelLateVoiceRun('hosted', 'workspace-a', 'hosted-run-late', api as never);
    expect(api.cancelOpenRouterRun).toHaveBeenCalledWith('workspace-a', 'hosted-run-late');
    expect(api.cancelExecution).not.toHaveBeenCalled();
  });

  it('keeps subscription fallback cancellation on the local execution API', async () => {
    const api = {
      cancelOpenRouterRun: vi.fn(async () => ({ canceled: true })),
      cancelExecution: vi.fn(async () => undefined),
    };
    await cancelLateVoiceRun('local', 'workspace-a', 'local-run-late', api as never);
    expect(api.cancelExecution).toHaveBeenCalledWith('local-run-late');
    expect(api.cancelOpenRouterRun).not.toHaveBeenCalled();
  });
});
