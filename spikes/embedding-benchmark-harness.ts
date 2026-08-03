import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { OllamaProvider, type EmbeddingProvider, type EmbeddingProvenance } from './embedding-provider.js'
import { corpus, queries, SUITE_VERSION } from './embedding-suite.js'

const execFileAsync = promisify(execFile)
const modelNames = process.argv.slice(2)
if (modelNames.length === 0) throw new Error('Usage: tsx spikes/embedding-benchmark-harness.ts <ollama-model> [...]')

function cosine(left: number[], right: number[]): number {
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] ** 2
    rightMagnitude += right[index] ** 2
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

async function benchmark(provider: EmbeddingProvider, model: string) {
  const modelInfo = await provider.modelInfo(model)
  const rssBefore = process.memoryUsage().rss
  const coldStarted = performance.now()
  const probe = await provider.embed(model, ['Waypoint local embedding readiness probe.'])
  const coldLatencyMs = performance.now() - coldStarted
  const indexStarted = performance.now()
  const corpusVectors = await provider.embed(model, corpus.map((item) => item.text))
  const indexMs = performance.now() - indexStarted
  const queryStarted = performance.now()
  const queryVectors = await provider.embed(model, queries.map((item) => item.text))
  const queryMs = performance.now() - queryStarted
  let recallAt1 = 0, recallAt3 = 0, reciprocalRank = 0
  const results = queryVectors.map((queryVector, queryIndex) => {
    const ranked = corpusVectors.map((vector, index) => ({ index, score: cosine(queryVector, vector) })).sort((a, b) => b.score - a.score)
    const expected = queries[queryIndex].expectedTopic
    const rank = ranked.findIndex(({ index }) => corpus[index].topic === expected) + 1
    if (rank === 1) recallAt1 += 1
    if (rank > 0 && rank <= 3) recallAt3 += 1
    if (rank > 0) reciprocalRank += 1 / rank
    return { query: queries[queryIndex].id, expected, top: corpus[ranked[0].index].topic, rank }
  })
  const provenance: EmbeddingProvenance = {
    provider: provider.id, providerVersion: provider.version, model,
    modelDigest: modelInfo.digest, dimensions: probe[0].length, suiteVersion: SUITE_VERSION,
  }
  return {
    provenance, corpusDocuments: corpus.length, queries: queries.length,
    quality: { recallAt1: recallAt1 / queries.length, recallAt3: recallAt3 / queries.length, meanReciprocalRank: reciprocalRank / queries.length },
    performance: { coldLatencyMs: Math.round(coldLatencyMs), indexMs: Math.round(indexMs), documentsPerSecond: Math.round(corpus.length / (indexMs / 1_000)), queryBatchMs: Math.round(queryMs), processRssDeltaMiB: Math.round((process.memoryUsage().rss - rssBefore) / 1024 / 1024) },
    modelSizeBytes: modelInfo.sizeBytes, license: modelInfo.license, format: modelInfo.format, quantization: modelInfo.quantization,
    auditStatus: 'No application npm dependency; local Ollama runtime/model managed separately and pinned by digest', results,
  }
}

const { stdout } = await execFileAsync('ollama', ['--version'], { timeout: 5_000 })
const provider = new OllamaProvider(stdout.trim())
const reports = []
for (const model of modelNames) reports.push(await benchmark(provider, model))
reports.sort((a, b) => b.quality.meanReciprocalRank - a.quality.meanReciprocalRank || b.performance.documentsPerSecond - a.performance.documentsPerSecond)
console.log(JSON.stringify({ suiteVersion: SUITE_VERSION, isolatedIndex: true, reports, recommendation: reports[0]?.provenance }, null, 2))
