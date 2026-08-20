import { describe, expect, it, vi } from "vitest";
import {
  ProviderDecisionGate,
  providerDecisionFingerprint,
} from "./provider-decision-gate.js";

describe("ProviderDecisionGate", () => {
  it("deduplicates concurrent provider callbacks and replays one answer", async () => {
    const gate = new ProviderDecisionGate();
    let resolve!: (value: {
      status: "accepted";
      decision: Record<string, unknown>;
    }) => void;
    const create = vi.fn(
      () =>
        new Promise<{
          status: "accepted";
          decision: Record<string, unknown>;
        }>((done) => {
          resolve = done;
        }),
    );
    const fingerprint = providerDecisionFingerprint({
        kind: "question",
        detail: { prompt: "Continue?", options: ["Yes", "No"] },
      }),
      first = gate.wait("execution-1", "request-1", fingerprint, create),
      duplicate = gate.wait("execution-1", "request-1", fingerprint, create);
    expect(duplicate).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    resolve({ status: "accepted", decision: { answers: { Receiver: "Stop" } } });
    await expect(first).resolves.toMatchObject({ status: "accepted" });
    await expect(duplicate).resolves.toMatchObject({
      decision: { answers: { Receiver: "Stop" } },
    });
    gate.clearExecution("execution-1");
    gate.wait("execution-1", "request-1", fingerprint, create);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("rejects reuse of one provider identity for a changed operation", () => {
    const gate = new ProviderDecisionGate(),
      create = vi.fn(
        async () =>
          ({ status: "accepted", decision: {} }) as const,
      );
    gate.wait(
      "execution-1",
      "request-1",
      providerDecisionFingerprint({ command: "git status" }),
      create,
    );
    expect(() =>
      gate.wait(
        "execution-1",
        "request-1",
        providerDecisionFingerprint({ command: "git clean -fd" }),
        create,
      ),
    ).toThrow(/reused with different content/);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
