import { PROVIDERS, type BenchmarkProvider } from './embedding-benchmark.js'

export class OllamaBenchmarkProvider implements BenchmarkProvider {
  readonly descriptor
  private readonly baseUrl:string
  constructor(version:string,baseUrl='http://127.0.0.1:11434'){
    const parsed=new URL(baseUrl)
    if(parsed.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||parsed.username||parsed.password||parsed.pathname!=='/')throw new Error('Ollama endpoint must be an unauthenticated HTTP loopback origin')
    this.baseUrl=parsed.origin;this.descriptor={...PROVIDERS[1],version:version.slice(0,100)}
  }
  async embed(model:string,inputs:string[]):Promise<number[][]>{if(!inputs.length||inputs.length>10_000)throw new Error('Bounded embedding input is required');const response=await fetch(`${this.baseUrl}/api/embed`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,input:inputs,keep_alive:'5m'}),signal:AbortSignal.timeout(120_000),redirect:'error'});if(!response.ok)throw new Error(`Ollama embedding failed (${response.status})`);const payload=await response.json() as {embeddings?:number[][]};if(!payload.embeddings||payload.embeddings.length!==inputs.length||payload.embeddings.some((vector)=>!vector.length||vector.length>65_536||vector.some((value)=>!Number.isFinite(value))))throw new Error('Ollama returned malformed embeddings');return payload.embeddings}
  async modelInfo(model:string):Promise<{digest:string;sizeBytes:number;license:string;format?:string;quantization?:string}>{const tagsResponse=await fetch(`${this.baseUrl}/api/tags`,{signal:AbortSignal.timeout(5_000),redirect:'error'});if(!tagsResponse.ok)throw new Error(`Ollama model listing failed (${tagsResponse.status})`);const tags=await tagsResponse.json() as {models?:Array<{name:string;digest:string;size:number}>},installed=tags.models?.find((candidate)=>candidate.name===model||candidate.name===`${model}:latest`);if(!installed||!Number.isSafeInteger(installed.size)||installed.size<0)throw new Error(`Ollama model is not installed: ${model}`);const detailResponse=await fetch(`${this.baseUrl}/api/show`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model}),signal:AbortSignal.timeout(5_000),redirect:'error'});if(!detailResponse.ok)throw new Error(`Ollama model detail failed (${detailResponse.status})`);const detail=await detailResponse.json() as {license?:string;model_info?:Record<string,unknown>;details?:{format?:string;quantization_level?:string}},license=String(detail.model_info?.['general.license']??'').trim()||(detail.license?.match(/^[^\n]+/)?.[0]??'').trim();if(!license)throw new Error(`Ollama model license metadata is missing: ${model}`);return{digest:installed.digest,sizeBytes:installed.size,license,format:detail.details?.format,quantization:detail.details?.quantization_level}}
  async runtimeMemoryMiB(model:string):Promise<number|null>{const response=await fetch(`${this.baseUrl}/api/ps`,{signal:AbortSignal.timeout(5_000),redirect:'error'});if(!response.ok)return null;const payload=await response.json() as {models?:Array<{name:string;size?:number}>},active=payload.models?.find((candidate)=>candidate.name===model||candidate.name===`${model}:latest`),bytes=active?.size;return typeof bytes==='number'&&Number.isFinite(bytes)&&bytes>=0?Math.round(bytes/1024/1024):null}
}

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

  async embed(inputs: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; modelDigest: string }> {
    if (!inputs.length) throw new Error('Embedding input is required')
    const [embeddingResponse, tagsResponse] = await Promise.all([
      fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model, input: inputs, keep_alive: '5m' }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000), redirect: 'error',
      }),
      fetch(`${this.baseUrl}/api/tags`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000), redirect: 'error' }),
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
