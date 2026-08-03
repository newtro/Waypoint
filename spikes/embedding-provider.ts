export interface EmbeddingProvenance {
  provider: string
  providerVersion: string
  model: string
  modelDigest: string
  dimensions: number
  suiteVersion: string
}

export interface EmbeddingProvider {
  readonly id: string
  readonly version: string
  embed(model: string, inputs: string[]): Promise<number[][]>
  modelInfo(model: string): Promise<{ digest: string; sizeBytes: number; license: string; format?: string; quantization?: string }>
}

export interface EmbeddingWorkerDescriptor {
  deviceId: string
  location: 'local' | 'trusted-peer'
  online: boolean
  availableMemoryGiB: number
  installedModels: string[]
  workspaceAllowed: boolean
  userPreference: number
}

export function selectEmbeddingWorker(
  workers: EmbeddingWorkerDescriptor[],
  model: string,
  minimumMemoryGiB: number,
): EmbeddingWorkerDescriptor | undefined {
  return workers
    .filter((worker) => worker.online && worker.workspaceAllowed && worker.availableMemoryGiB >= minimumMemoryGiB && worker.installedModels.includes(model))
    .sort((left, right) => right.userPreference - left.userPreference || Number(right.location === 'local') - Number(left.location === 'local'))[0]
}

export function requiresReindex(previous: EmbeddingProvenance, next: EmbeddingProvenance): boolean {
  return previous.provider !== next.provider
    || previous.providerVersion !== next.providerVersion
    || previous.model !== next.model
    || previous.modelDigest !== next.modelDigest
    || previous.dimensions !== next.dimensions
    || previous.suiteVersion !== next.suiteVersion
}

export class OllamaProvider implements EmbeddingProvider {
  readonly id = 'ollama-local'
  private readonly baseUrl: string
  constructor(readonly version: string, baseUrl = 'http://127.0.0.1:11434') {
    const parsed = new URL(baseUrl)
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]'
    if (parsed.protocol !== 'http:' || !loopback || parsed.username || parsed.password || parsed.pathname !== '/') {
      throw new Error('Ollama endpoint must be an unauthenticated HTTP loopback origin')
    }
    this.baseUrl = parsed.origin
  }

  async embed(model: string, inputs: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: inputs, keep_alive: '5m' }),
      signal: AbortSignal.timeout(120_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Ollama embedding failed (${response.status}): ${await response.text()}`)
    const payload = await response.json() as { embeddings?: number[][] }
    if (!payload.embeddings || payload.embeddings.length !== inputs.length) throw new Error('Ollama returned malformed embeddings')
    return payload.embeddings
  }

  async modelInfo(model: string): Promise<{ digest: string; sizeBytes: number; license: string; format?: string; quantization?: string }> {
    const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000), redirect: 'error' })
    if (!response.ok) throw new Error(`Ollama model listing failed (${response.status})`)
    const payload = await response.json() as { models?: Array<{ name: string; digest: string; size: number }> }
    const found = payload.models?.find((candidate) => candidate.name === model || candidate.name === `${model}:latest`)
    if (!found) throw new Error(`Ollama model is not installed: ${model}`)
    const detailResponse = await fetch(`${this.baseUrl}/api/show`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5_000), redirect: 'error',
    })
    if (!detailResponse.ok) throw new Error(`Ollama model detail failed (${detailResponse.status})`)
    const detail = await detailResponse.json() as { license?: string; model_info?: Record<string, unknown>; details?: { format?: string; quantization_level?: string } }
    const license = String(detail.model_info?.['general.license'] ?? '').trim() || (detail.license?.match(/^[^\n]+/)?.[0] ?? '').trim()
    if (!license) throw new Error(`Ollama model license metadata is missing: ${model}`)
    return { digest: found.digest, sizeBytes: found.size, license, format: detail.details?.format, quantization: detail.details?.quantization_level }
  }
}
