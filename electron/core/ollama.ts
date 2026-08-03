export class LocalOllamaEmbeddings {
  readonly provider = 'ollama-local'
  readonly providerVersion = '1'

  constructor(readonly model = 'qwen3-embedding:4b', private readonly baseUrl = 'http://127.0.0.1:11434') {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== '/') {
      throw new Error('Ollama endpoint must be an unauthenticated HTTP loopback origin')
    }
  }

  async status(): Promise<{ configured: true; reachable: boolean; model: string; modelInstalled: boolean }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2_000), redirect: 'error' })
      if (!response.ok) return { configured: true, reachable: false, model: this.model, modelInstalled: false }
      const payload = await response.json() as { models?: Array<{name:string}> }
      return { configured: true, reachable: true, model: this.model, modelInstalled: Boolean(payload.models?.some((candidate)=>candidate.name===this.model||candidate.name===`${this.model}:latest`)) }
    } catch { return { configured: true, reachable: false, model: this.model, modelInstalled: false } }
  }

  async embed(inputs: string[]): Promise<{ vectors: number[][]; modelDigest: string }> {
    if (!inputs.length) throw new Error('Embedding input is required')
    const [embeddingResponse, tagsResponse] = await Promise.all([
      fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model, input: inputs, keep_alive: '5m' }),
        signal: AbortSignal.timeout(120_000), redirect: 'error',
      }),
      fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000), redirect: 'error' }),
    ])
    if (!embeddingResponse.ok) throw new Error(`Ollama embedding failed (${embeddingResponse.status})`)
    if (!tagsResponse.ok) throw new Error(`Ollama model listing failed (${tagsResponse.status})`)
    const payload = await embeddingResponse.json() as { embeddings?: number[][] }
    const tags = await tagsResponse.json() as { models?: Array<{ name: string; digest: string }> }
    const installed = tags.models?.find((candidate) => candidate.name === this.model || candidate.name === `${this.model}:latest`)
    if (!installed) throw new Error(`Ollama model is not installed: ${this.model}`)
    if (!payload.embeddings || payload.embeddings.length !== inputs.length || payload.embeddings.some((vector) => !vector.length || vector.some((value) => !Number.isFinite(value)))) throw new Error('Ollama returned malformed embeddings')
    return { vectors: payload.embeddings, modelDigest: installed.digest }
  }
}
