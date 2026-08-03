# Phase 0 embedding evaluation

## Decision

Waypoint uses a swappable embedding provider layer. Ollama is the preferred optional local runtime for the MVP because it exposes a stable loopback API, manages model pulls/removal separately from the Electron package, supports native macOS and Windows installation, and adds no application npm dependency. Waypoint must retain lexical search when Ollama or the selected model is unavailable.

Current evidence recommends **Qwen3-Embedding 4B through Ollama** as the quality-first default for suite v2. **BGE-M3** is the lighter fallback. The 8B variant and a reranker are not justified by current evidence.

## Automated harness

`spikes/embedding-benchmark-harness.ts`:

- registers the Ollama provider and any requested installed models;
- builds an isolated in-memory vector index;
- runs versioned `waypoint-retrieval-v2` corpus/query fixtures;
- reports Recall@1, Recall@3, mean reciprocal rank, cold latency, indexing throughput, query latency, model size, and process-memory observation;
- captures provider/model version, model digest, dimensions, and suite version;
- recommends by quality first, then throughput;
- never places benchmark vectors in a real workspace.

Changing provider, provider version, model, digest, dimensions, or suite version makes reindexing explicit. Existing vectors remain associated with their old provenance until the replacement index succeeds, so rollback is possible.

## Current Mac comparison

Host: Apple Silicon macOS; Ollama 0.30.10; 32 distinct Waypoint-oriented passages; 24 paraphrased and distractor-bearing queries. Acceptance thresholds, set for the Phase 0 gate, are R@1 ≥ 0.80, R@3 ≥ 0.95, and MRR ≥ 0.90.

| Candidate | R@1 / R@3 / MRR | Cold | Index | Query batch | Model size |
|---|---:|---:|---:|---:|---:|
| BGE-M3 | .833 / .958 / .906 | .96 s | 70 docs/s | 349 ms | 1.16 GB |
| Qwen3-Embedding 4B | .833 / 1.0 / .917 | .92 s | 20 docs/s | 1.19 s | 2.50 GB |

Suite v2 replaces repeated boilerplate with distinct lifecycle, sync, security, future-feature, routing, onboarding, and recovery passages plus three queries per intent. It now exposes real ranking differences, but it remains a Phase 0 product fixture rather than a universal benchmark. Future versions should add long chunks, mixed languages, code/tables, and user-derived anonymized cases.

The retained machine-readable report is `implementation/evidence/embedding-benchmark-waypoint-retrieval-v2.json`. It pins exact runtime/model identity, digest, dimensions, license, format, quantization, thresholds, and results.

## Rejected candidates

- `@huggingface/transformers` + MiniLM q8: fast and compact enough on this Mac, but rejected and removed after four unpatched high-severity dependency advisories.
- Pure-JavaScript TensorFlow + Universal Sentence Encoder: audit-clean and 5/5 on a small trial, but rejected for 23 s cold load, 4 docs/s, +373 MiB RSS, and roughly 340 MiB installed dependencies.
- TensorFlow native Node backend: rejected and removed after three high and one critical dependency advisories.

## Direct llama.cpp fallback assessment

Ollama already uses a llama.cpp-family native inference foundation while providing model lifecycle and a local API. A direct `llama.cpp` provider remains a lower-level fallback if Ollama setup or lifecycle becomes unacceptable. It would require Waypoint to own binary signing/upgrades, GGUF selection/download verification, process supervision, port/IPC security, GPU/CPU flags, and per-platform testing. No direct llama.cpp executable was installed on this Mac, so Phase 0 does not claim measured parity.

## Trusted peer-device worker seam

`EmbeddingWorkerDescriptor` and `selectEmbeddingWorker` capture future routing by:

- required model capability and minimum memory;
- device online state;
- workspace policy allowing content on that trusted peer;
- explicit user preference;
- local fallback when the peer is unavailable.

Remote serving is not implemented in Phase 0. A later gate must add mutual device authentication, encrypted transport, request size/time budgets, cancellation, provenance returned by the worker, deletion/no-retention guarantees, offline queue policy, and tests proving that unavailable peers never cause silent model changes or external routing.

## Model lifecycle and UX

- Onboarding detects Ollama; it does not require it.
- The user explicitly chooses to install/pull a model and sees size, license, device suitability, and expected reindex impact.
- Waypoint verifies exact model digest before indexing and records it on every vector/index generation.
- Model removal never deletes source content; it marks semantic search unavailable until a compatible index/model is selected.
- Switching models builds a separate generation, atomically activates it after success, and keeps the prior generation until the user accepts cleanup.
- Windows model/runtime behavior is mandatory platform-contingent verification when development moves to Windows.
- The adapter accepts only unauthenticated HTTP loopback origins and rejects redirects. Ollama's local API itself has no Waypoint-managed authentication; another local process under the user's account may access it, so OS account isolation and binding only to loopback remain residual controls.
- Ollama is a separately installed MIT-licensed runtime and is not covered by npm audit. Supported adoption requires a pinned minimum/version policy and review of official release/security information; model blobs are pinned by digest and their embedded license metadata must be present.

## Optional hosted comparison plan

Later, with a user-supplied API key and explicit cost authorization, the same frozen suite may compare local candidates against OpenAI `text-embedding-3-small` and `text-embedding-3-large`. No hosted embedding call is authorized or performed in Phase 0.

The hosted-provider report must use identical corpus text, queries, chunking, ranking, and quality metrics; disclose estimated and actual token/cost totals; and record provider, exact model, requested/output dimensions, API/client version, suite version, timestamp, and response/request identifiers where safely available. Hosted vectors remain in the isolated benchmark index and are never mixed into a real workspace. The recommendation must separately score privacy/offline availability and may not choose a hosted default solely from retrieval quality.

## Future chunking-policy benchmark hook

Chunking is a pluggable, versioned input to every embedding index. `ChunkingPolicy` and `ChunkingProvenance` reserve provider/version, policy name, configuration digest, offsets, and suite version; any change requires an explicit new index generation.

The benchmark harness will add a chunking matrix using the same retrieval cases plus long-form Markdown, chat transcripts, source code, tables, and mixed-language documents. It will report retrieval quality, chunk count/size distribution, boundary integrity, overlap/storage cost, indexing latency, and failure behavior.

Chonkie (`chonkie-inc/chonkie`) is a future candidate for token, sentence, recursive, semantic, late, code, neural, and LLM-assisted strategies. It is not a Phase 0 production dependency. Evaluation must cover Python/runtime and model packaging, dependency/security audit, offline behavior, supported document types, licensing, resource use, and native macOS/Windows setup. LLM-assisted chunking also requires separate privacy and cost authorization and cannot be a silent default.
