export interface Chunk {
  id: string
  text: string
  startOffset: number
  endOffset: number
}

export interface ChunkingProvenance {
  provider: string
  providerVersion: string
  policy: string
  policyConfigDigest: string
  suiteVersion: string
}

export interface ChunkingPolicy {
  readonly provider: string
  readonly providerVersion: string
  readonly policy: string
  chunk(documentId: string, text: string): Promise<Chunk[]>
}

export function chunkingRequiresReindex(previous: ChunkingProvenance, next: ChunkingProvenance): boolean {
  return previous.provider !== next.provider
    || previous.providerVersion !== next.providerVersion
    || previous.policy !== next.policy
    || previous.policyConfigDigest !== next.policyConfigDigest
    || previous.suiteVersion !== next.suiteVersion
}
