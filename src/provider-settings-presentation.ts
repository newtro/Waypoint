type CapabilityState =
  | "no_key"
  | "disabled"
  | "activation_required"
  | "model_required"
  | "ready_unverified"
  | "cap_reached";

type CapabilityHealth =
  | "not_configured"
  | "not_checked"
  | "verified"
  | "failed";

export type ProviderCapabilityPresentation = {
  title: string;
  health: string;
  tone: "ready" | "quiet" | "warning";
};

export function providerCapabilityPresentation(
  state: CapabilityState,
  health: CapabilityHealth,
): ProviderCapabilityPresentation {
  const title = {
      no_key: "Add a protected key",
      disabled: "Hosted routing is off",
      activation_required: "Activation required",
      model_required: "Choose hosted models",
      ready_unverified: "Hosted route ready",
      cap_reached: "Spending cap reached",
    }[state],
    healthLabel = {
      not_configured: "Not configured",
      not_checked: "No background health check",
      verified: "Last authorized request verified",
      failed: "Last authorized request failed",
    }[health];
  return {
    title,
    health: healthLabel,
    tone:
      state === "cap_reached" || health === "failed"
        ? "warning"
        : state === "ready_unverified"
          ? "ready"
          : "quiet",
  };
}

export function formatProviderMicros(micros: number, digits = 2): string {
  return `$${(Math.max(0, micros) / 1_000_000).toFixed(digits)}`;
}
