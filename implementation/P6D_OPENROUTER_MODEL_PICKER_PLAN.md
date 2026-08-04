# P6D OpenRouter picker and focused chat UI repair — acceptance gate

## Boundary

Focused renderer enhancement over the existing protected OpenRouter provider and durable chat lifecycle. No provider request, key access, activation change, cost-policy change, migration rewrite, external service, execution-semantics change, or routing-authority expansion.

## Acceptance

1. Strategic and everyday model controls list Kimi K3 (`moonshotai/kimi-k3`), Z.ai GLM 5.2 (`z-ai/glm-5.2`), Qwen 3.8 Max (`qwen/qwen3.8-max`), and DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) with readable names and exact IDs. Qwen displays the supplied current listing of $2/M input and $6/M output.
2. Choosing an option updates the existing strategic/everyday fields and follows the existing save, validation, route, receipt, budget, fallback, backup, and sync paths.
3. Any non-empty saved ID outside the curated catalog—including an earlier Qwen 3.7 selection—remains selected and visible as a legacy/custom option. Empty configuration remains empty until the user chooses; no upgrade silently changes live behavior.
4. Controls have explicit accessible labels and do not expose or access the protected API key.
5. Focused catalog, legacy preservation, persistence/reopen, route selection, and Settings-source contract tests pass; full test/lint/build/package/runtime gates and independent review have no unresolved blocker/high.
6. Each durable execution and structured event renders once, attached after its source user message. Execution/tool history stays readable and redacted, while a completed assistant reply is visually below the execution history for its turn.
7. Response-progress status clears from the header/toast and removes its cancel affordance on every terminal result: success, cancellation, failure, and timeout. Non-response notices and durable execution history remain intact.
8. Delegate task and Knowledge are a compact, right-aligned, keyboard-accessible action group at normal and maximized desktop widths, with responsive labels and no excessive gap.
