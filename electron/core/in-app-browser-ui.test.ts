import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("In-App Browser chrome", () => {
  const component = readFileSync(
    new URL("../../src/main.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../../src/in-app-browser.css", import.meta.url),
    "utf8",
  );

  it("presents navigation, address, session, policy, and empty-state hierarchy", () => {
    for (const token of [
      "browser-nav-actions",
      "browser-address-field",
      "browser-session-actions",
      "browser-policy-chips",
      "browser-empty-state",
      "browser-error-banner",
    ])
      expect(component).toContain(token);
    expect(component).toContain("inAppBrowserState?.error || error");
  });

  it("keeps the browser responsive and honors reduced motion", () => {
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".browser-progress");
  });
});
