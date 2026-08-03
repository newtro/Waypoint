import { performance } from 'node:perf_hooks'

export const DIMENSIONS = 384

export function localFeatureVector(text: string): Float32Array {
  const vector = new Float32Array(DIMENSIONS)
  const normalized = text.normalize('NFKC').toLocaleLowerCase('en-US')
  for (let index = 0; index < normalized.length - 2; index += 1) {
    const gram = normalized.slice(index, index + 3)
    let hash = 2166136261
    for (const character of gram) {
      hash ^= character.codePointAt(0) ?? 0
      hash = Math.imul(hash, 16777619)
    }
    vector[(hash >>> 0) % DIMENSIONS] += 1
  }
  let magnitude = 0
  for (const value of vector) magnitude += value * value
  magnitude = Math.sqrt(magnitude)
  if (magnitude > 0) {
    for (let index = 0; index < vector.length; index += 1) vector[index] /= magnitude
  }
  return vector
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const corpus = Array.from({ length: 10_000 }, (_, index) =>
    `Document ${index}: Waypoint keeps personal notes, durable chats, and connected memories on owned devices.`,
  )
  const start = performance.now()
  for (const document of corpus) localFeatureVector(document)
  const elapsedMs = performance.now() - start
  console.log(JSON.stringify({
    documents: corpus.length,
    dimensions: DIMENSIONS,
    elapsedMs: Math.round(elapsedMs),
    documentsPerSecond: Math.round(corpus.length / (elapsedMs / 1_000)),
    note: 'Feasibility baseline for local vector generation; not a semantic-quality model.',
  }, null, 2))
}
