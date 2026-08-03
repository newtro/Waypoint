import { describe, expect, it } from 'vitest'
import { OllamaProvider, requiresReindex, selectEmbeddingWorker, type EmbeddingProvenance } from './embedding-provider.js'

const baseline: EmbeddingProvenance = { provider: 'ollama-local', providerVersion: '1', model: 'qwen', modelDigest: 'abc', dimensions: 1024, suiteVersion: 'v1' }

describe('embedding provenance', () => {
  it('does not reindex identical provenance', () => expect(requiresReindex(baseline, { ...baseline })).toBe(false))
  it.each(['provider', 'providerVersion', 'model', 'modelDigest', 'dimensions', 'suiteVersion'] as const)('requires reindex when %s changes', (field) => {
    expect(requiresReindex(baseline, { ...baseline, [field]: field === 'dimensions' ? 768 : 'changed' })).toBe(true)
  })
})

describe('embedding worker policy', () => {
  const local = { deviceId: 'pc', location: 'local' as const, online: true, availableMemoryGiB: 16, installedModels: ['bge-m3'], workspaceAllowed: true, userPreference: 1 }
  const peer = { deviceId: 'mac', location: 'trusted-peer' as const, online: true, availableMemoryGiB: 32, installedModels: ['bge-m3', 'qwen3-embedding:4b'], workspaceAllowed: true, userPreference: 10 }

  it('selects an explicitly preferred capable trusted peer', () => expect(selectEmbeddingWorker([local, peer], 'bge-m3', 8)?.deviceId).toBe('mac'))
  it('falls back to local when the peer is offline', () => expect(selectEmbeddingWorker([local, { ...peer, online: false }], 'bge-m3', 8)?.deviceId).toBe('pc'))
  it('never routes workspace data to a disallowed peer', () => expect(selectEmbeddingWorker([local, { ...peer, workspaceAllowed: false }], 'bge-m3', 8)?.deviceId).toBe('pc'))
  it('returns unavailable instead of silently changing models', () => expect(selectEmbeddingWorker([local, peer], 'qwen3-embedding:8b', 20)).toBeUndefined())
})

describe('Ollama local-only boundary', () => {
  it.each(['https://127.0.0.1:11434', 'http://example.com:11434', 'http://user:pass@localhost:11434', 'http://localhost:11434/path'])('rejects unsafe endpoint %s', (endpoint) => {
    expect(() => new OllamaProvider('test', endpoint)).toThrow(/loopback/)
  })
  it('accepts IPv4, IPv6, and localhost loopback origins', () => {
    expect(() => new OllamaProvider('test', 'http://127.0.0.1:11434')).not.toThrow()
    expect(() => new OllamaProvider('test', 'http://[::1]:11434')).not.toThrow()
    expect(() => new OllamaProvider('test', 'http://localhost:11434')).not.toThrow()
  })
})
