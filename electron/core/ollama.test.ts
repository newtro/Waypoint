import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalOllamaEmbeddings, OllamaBenchmarkProvider } from './ollama.js'

afterEach(() => vi.unstubAllGlobals())

describe('local Ollama embedding boundary', () => {
  it('rejects non-loopback benchmark providers',()=>expect(()=>new OllamaBenchmarkProvider('test','https://example.com')).toThrow(/loopback/))
  it('uses total loaded model memory rather than only its VRAM subset',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({models:[{name:'model:latest',size:12*1024**3,size_vram:4*1024**3}]}),{status:200})));await expect(new OllamaBenchmarkProvider('test').runtimeMemoryMiB('model')).resolves.toBe(12*1024)})
  it('rejects non-loopback and credentialed endpoints', () => {
    expect(() => new LocalOllamaEmbeddings('model', 'https://example.com')).toThrow(/loopback/)
    expect(() => new LocalOllamaEmbeddings('model', 'http://user:pass@127.0.0.1:11434')).toThrow(/loopback/)
  })

  it('returns vectors with installed model digest provenance', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).endsWith('/api/embed')
      ? new Response(JSON.stringify({ embeddings: [[1, 0]] }), { status: 200 })
      : new Response(JSON.stringify({ models: [{ name: 'model:latest', digest: 'sha256:model' }] }), { status: 200 })))
    await expect(new LocalOllamaEmbeddings('model').embed(['text'])).resolves.toEqual({ vectors: [[1, 0]], modelDigest: 'sha256:model' })
  })

  it('fails closed on malformed vectors or an uninstalled model', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).endsWith('/api/embed')
      ? new Response(JSON.stringify({ embeddings: [[]] }), { status: 200 })
      : new Response(JSON.stringify({ models: [] }), { status: 200 })))
    await expect(new LocalOllamaEmbeddings('missing').embed(['text'])).rejects.toThrow(/not installed/)
  })
})
