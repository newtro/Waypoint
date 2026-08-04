export async function cancelLateVoiceRun(
  kind: 'hosted' | 'local',
  workspaceId: string,
  runId: string,
  api: Pick<Window['waypoint'], 'cancelOpenRouterRun' | 'cancelExecution'>,
): Promise<void> {
  if (kind === 'hosted') {
    await api.cancelOpenRouterRun(workspaceId, runId);
    return;
  }
  await api.cancelExecution(runId);
}
