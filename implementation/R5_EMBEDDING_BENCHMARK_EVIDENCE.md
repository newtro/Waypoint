# R5 Slice 3 — embedding and chunking benchmark evidence

## Local candidate run

- Suite: `waypoint-retrieval-v2`, 32 representative passages and 24 queries, isolated in-memory index.
- Qwen3-Embedding 4B (`ollama 0.30.10`, Q4_K_M GGUF, 2,496,704,041 bytes, Apache-2.0, digest recorded): whole-document recall@1 0.8333, recall@3 1.0, MRR 0.9167; index 4,630 ms, query batch 1,221 ms.
- BGE-M3 (F16 GGUF, 1,157,672,605 bytes, MIT, digest recorded): whole-document recall@1 0.8333, recall@3 0.9583, MRR 0.90625; index 1,910 ms, query batch 345 ms.
- Qwen3-Embedding 8B: unavailable because the model is not installed; no download was attempted.
- Deterministic fixture baseline: recall@1 0.4167, recall@3 0.7917, MRR 0.615; explicitly excluded from production recommendation.
- Current evidence recommends Qwen3-Embedding 4B with the production-ready whole-document policy. Sentence-window results are retained for comparison but cannot become the default because that policy remains experimental.
- Current Mac evidence reports 36 GiB host memory through the OS. Ollama `/api/ps` reported 8,336 MiB runtime memory for Qwen3-Embedding 4B and 634 MiB for BGE-M3; harness RSS remains separate. A default requires recall@1 ≥ 0.80, recall@3 ≥ 0.95, MRR ≥ 0.90, registered model minimum memory, measured provider runtime memory, and at least 20% host-memory reserve.

## Deferred gates

- Direct llama.cpp: native packaging, model lifecycle/API compatibility, dependency/license audit, and macOS/Windows setup.
- Chonkie: Python/runtime packaging, audit, document-type support, and native platform setup.
- Trusted peer worker: transport, physical-peer availability, workspace policy, user preference, fallback, and two-device validation.
- OpenAI embedding comparison: user-supplied key plus explicit API cost/data authorization.

## Verification

- Focused implementation gate: 3 files / 30 tests, lint, and production build passed.
- Initial independent review: blocker 0 / high 3 / medium 3 / low 1. It rejected recommendation eligibility, non-reversible live reindexing, caller-controlled capability/resource gates, absent peer registration, unmeasured memory, provider/model mismatch, and duplicate suite version.
- Repairs enforce the canonical registry/model pairing, strict corpus/chunk/batch/vector bounds, measured runtime-memory and quality thresholds, a disabled trusted-peer provider seam, one suite constant, and two bounded provenance-distinct live generations for rollback. Source deletion or revision replacement still purges all generations.
- First follow-up review retained one high and one medium: hybrid CPU/GPU memory could be undercounted and the generic provider boundary lacked a total deadline. Repairs now use Ollama's total loaded `size` (not `size_vram`) and enforce a maximum 180-second whole-benchmark deadline, with hybrid-memory and hung-provider regressions.
- Final independent verdict: ship — blocker 0 / high 0 / medium 0 / low 0. Reviewer reran 3 files / 34 focused tests, lint, build, and diff hygiene.
- Terminal gate: 64 suites / 288 tests, lint, build, zero high dependency vulnerabilities/undeclared licenses, CycloneDX production SBOM generation, native arm64 macOS package, packaged runtime closure, isolated-profile native launch, and diff hygiene.
