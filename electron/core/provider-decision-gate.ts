import type { CodexProviderDecision } from "./codex-app-server.js";

/**
 * Provider SDKs can report one permission request through multiple callbacks.
 * Keep one live waiter so every callback receives the same durable answer.
 */
export class ProviderDecisionGate {
  private readonly pending = new Map<
    string,
    { fingerprint: string; promise: Promise<CodexProviderDecision> }
  >();
  private readonly executionKeys = new Map<string, Set<string>>();

  wait(
    executionId: string,
    durableRequestId: string,
    fingerprint: string,
    create: () => Promise<CodexProviderDecision>,
  ): Promise<CodexProviderDecision> {
    const existing = this.pending.get(durableRequestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error(
          "Provider request identity was reused with different content",
        );
      return existing.promise;
    }
    const promise = create();
    this.pending.set(durableRequestId, { fingerprint, promise });
    const keys = this.executionKeys.get(executionId) ?? new Set<string>();
    keys.add(durableRequestId);
    this.executionKeys.set(executionId, keys);
    return promise;
  }

  clearExecution(executionId: string): void {
    for (const key of this.executionKeys.get(executionId) ?? [])
      this.pending.delete(key);
    this.executionKeys.delete(executionId);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  return value;
}

/** Exact, order-independent live identity for approval and question payloads. */
export function providerDecisionFingerprint(value: unknown): string {
  return JSON.stringify(canonical(value));
}
