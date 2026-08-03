# R0 local protocol-freeze evidence

## Implemented

- `electron/core/sync/protocol-contract.ts` is the machine-readable local contract for protocol/schema support, retention, limits, support targets, recovery posture, release identity, and delivery/enrollment/presence/ack/backup metadata surfaces.
- The opaque relay now consumes the frozen limits and rejects envelopes whose sender-selected lifetime exceeds seven days.
- `electron/core/sync/r0-contract.test.ts` provides the versioned representative contract fixture across negotiation, metadata minimization, real signed relay composition, epoch/replay/revocation/lifetime, Argon2id13/XChaCha recovery round trip, and stale-peer deletion dominance.

## Gate status

- Focused final verification: 4 suites / 23 tests pass across R0 contract, recovery crypto, relay, and durable sync state.
- Full final verification: 35 suites / 179 tests; ESLint; composite TypeScript/Vite production build; high-severity dependency audit with zero vulnerabilities; native macOS directory packaging; packaged runtime import closure; and `git diff --check` all pass.
- Independent first pass found 3 high and 3 medium issues: unbound tombstone acknowledgements, non-interoperable recovery, incomplete metadata mapping, weak opaque-ID bounds, contradictory retention wording, and a signature-composition gap.
- Repairs bind acknowledgements to the current delete identity with legacy migration coverage; add fixed Argon2id13/XChaCha create→recover fixtures and exact byte validation; enumerate/supersede node metadata surfaces; require bounded random client IDs; consume canonical retention; and prove signed routing/epoch/sequence/expiry composition.
- Independent final verdict: **CLEAN PASS** — blocker 0, high 0, medium 0, low 0.

Real Ubuntu/AWS, TLS, public-network, Windows, signing, update, and professional protocol review remain explicitly outside this local gate.
