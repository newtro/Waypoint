# R5 Slice 3 — local embedding and chunking benchmark

## Scope

Productionize the approved swappable embedding/chunking benchmark boundary without downloading models, changing external state, mutating a live workspace index, or enabling peer/API execution.

## Acceptance gate

1. Register versioned providers, models, and chunk policies. Qwen3-Embedding 4B is the quality candidate, Qwen 8B is conditional, and BGE-M3 is the lighter baseline.
2. Run a versioned representative Waypoint corpus/query suite through an isolated in-memory index and deterministic fixture baseline.
3. Report recall@1, recall@3, MRR, indexing/query latency, harness memory delta, unavailable provider-runtime memory, model bytes, license, format, quantization, digest, and audit status without substituting aggregate benchmark claims.
4. Recommend only completed non-fixture candidates under production-ready chunking; unavailable or malformed candidates fail truthfully.
5. Tie live embeddings to provider/model/version/digest, exact source revision, and chunk-policy identity/version/digest so reindex is explicit and reversible.
6. Keep trusted-peer workers, direct llama.cpp, Chonkie, and OpenAI comparisons disabled behind typed policy seams and their stated future gates. Chonkie is a first-class swappable chunk-policy candidate, not an integrated product option: its gate must measure representative retrieval quality, exact provenance/boundary fidelity, latency/memory, and deletion/reindex/rollback behavior; audit its dependency, license, and security posture; and prove native macOS/Windows packaging without implicit Python installation, cloud access, or model download.
7. Pass focused/full tests, lint, build, dependency audit, macOS package/runtime/native launch, diff hygiene, and independent adversarial review with no unresolved blocker/high finding.

## Boundaries

- Ollama is optional and loopback-only. The harness never pulls a model.
- No Docker, API key, external network, cloud, account, work data, peer execution, or two-instance validation.
- Benchmark vectors never enter the workspace database. Existing source deletion and workspace isolation remain authoritative.
