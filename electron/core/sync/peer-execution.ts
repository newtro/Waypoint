export interface PeerExecutionRequest {
  requestId: string
  sourceDeviceId: string
  targetDeviceId: string
  profileId: string
  tool: string
  workspaceRoot: string
  issuedAt: string
  expiresAt: string
  payload: unknown
}

export interface LocalExecutionProfile {
  id: string
  enabled: boolean
  allowedSourceDeviceIds: readonly string[]
  allowedTools: readonly string[]
  allowedWorkspaceRoots: readonly string[]
  requiresApproval: boolean
}

export type PeerDecision = { allowed: true; profile: LocalExecutionProfile } | { allowed: false; reason: string }

function withinRoot(path: string, root: string): boolean {
  const normalize = (input: string): string | undefined => {
    const replaced = input.replaceAll('\\', '/'), drive = replaced.match(/^([A-Za-z]:)\//)?.[1].toLowerCase()
    if (!replaced.startsWith('/') && !drive) return undefined
    const parts: string[] = []
    for (const part of replaced.slice(drive ? 3 : 1).split('/')) {
      if (!part || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return `${drive ?? ''}/${parts.join('/')}`.replace(/\/$/, '')
  }
  const normalizedPath = normalize(path), normalizedRoot = normalize(root)
  if (!normalizedPath || !normalizedRoot) return false
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

export class PeerExecutionAuthorizer {
  constructor(private readonly options: {
    localDeviceId: string
    now: () => Date
    isActiveSource: (deviceId: string) => boolean
    verify: (request: PeerExecutionRequest) => Promise<boolean>
    approve: (request: PeerExecutionRequest, profile: LocalExecutionProfile) => Promise<boolean>
    replayStore:{hasPeerRequest(requestId:string):boolean;consumePeerRequest(requestId:string):void}
  }) {}

  async authorize(request: PeerExecutionRequest, profile: LocalExecutionProfile | undefined): Promise<PeerDecision> {
    if (!request.requestId || !request.sourceDeviceId || !request.profileId) return { allowed: false, reason: 'Request identity is invalid' }
    if (this.options.replayStore.hasPeerRequest(request.requestId)) return { allowed: false, reason: 'Request already consumed' }
    if (request.targetDeviceId !== this.options.localDeviceId) return { allowed: false, reason: 'Wrong target device' }
    if (!this.options.isActiveSource(request.sourceDeviceId)) return { allowed: false, reason: 'Source device is not actively enrolled' }
    const now = this.options.now().getTime(), issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt)
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 30_000 || expires <= now || expires <= issued || expires - issued > 10 * 60_000) return { allowed: false, reason: 'Request is expired or invalid' }
    if (!(await this.options.verify(request))) return { allowed: false, reason: 'Request authentication failed' }
    // An authenticated terminal decision consumes the nonce, including a policy denial.
    this.options.replayStore.consumePeerRequest(request.requestId)
    if (!profile || profile.id !== request.profileId || !profile.enabled) return { allowed: false, reason: 'Local profile is unavailable' }
    if (!profile.allowedSourceDeviceIds.includes(request.sourceDeviceId)) return { allowed: false, reason: 'Source is not allowed by local profile' }
    if (!profile.allowedTools.includes(request.tool)) return { allowed: false, reason: 'Tool is not allowed by local profile' }
    if (!profile.allowedWorkspaceRoots.some((root) => withinRoot(request.workspaceRoot, root))) return { allowed: false, reason: 'Workspace root is not allowed by local profile' }
    if (!(await this.options.approve(request, profile))) return { allowed: false, reason: 'Local approval denied' }
    return { allowed: true, profile }
  }
}
