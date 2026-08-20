import { describe, expect, it } from "vitest";
import { assertRoute, proposeRoute } from "./provider-routing.js";
const ready = [
  {
    name: "codex" as const,
    available: true,
    compatible: true,
    version: "0.146.0",
  },
  {
    name: "claude" as const,
    available: true,
    compatible: true,
    version: "2.1.220",
  },
];
describe("local provider routing", () => {
  it("honors preference and reports the shared image/document delivery contract without a Waypoint file-size cap", () => {
    const route = proposeRoute({
      capabilities: ready,
      preferred: "claude",
      allowFallback: false,
      securityProfileId: "profile-a",
      attachments: [
        { id: "text", mediaType: "text/plain", bytes: 10 },
        { id: "large", mediaType: "text/plain", bytes: 25 * 1024 * 1024 + 1 },
        { id: "image", mediaType: "image/png", bytes: 10 },
        { id: "pdf", mediaType: "application/pdf", bytes: 10 },
        {
          id: "docx",
          mediaType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes: 10,
        },
      ],
    });
    expect(route).toMatchObject({
      selected: "claude",
      eligible: ["codex", "claude"],
      fallback: [],
      fallbackEnabled: false,
      device: "local",
    });
    expect(
      route.providers.find((item) => item.provider === "claude"),
    ).toMatchObject({
      deliverableAttachmentIds: ["text", "large", "image", "pdf", "docx"],
      localOnlyAttachmentIds: [],
    });
    expect(route.explanation.join(" ")).toContain("extracted locally");
    expect(() => assertRoute(route, "claude", "profile-a")).not.toThrow();
  });
  it("fails closed without fallback and uses only eligible local CLI when opted in", () => {
    const capabilities = [
        { name: "codex" as const, available: false, error: "missing" },
        {
          name: "claude" as const,
          available: true,
          compatible: true,
          version: "2.1.220",
        },
      ],
      closed = proposeRoute({
        capabilities,
        preferred: "codex",
        allowFallback: false,
        securityProfileId: "p",
        attachments: [],
      }),
      open = proposeRoute({
        capabilities,
        preferred: "codex",
        allowFallback: true,
        securityProfileId: "p",
        attachments: [],
      });
    expect(closed.selected).toBeUndefined();
    expect(open).toMatchObject({ selected: "claude", fallback: [] });
    expect(() => assertRoute(open, "codex", "p")).toThrow(/not eligible/);
  });
  it("rejects incompatible CLIs and profile substitution", () => {
    const route = proposeRoute({
      capabilities: [
        {
          name: "codex",
          available: true,
          compatible: false,
          compatibilityError: "stale",
        },
        { name: "claude", available: false },
      ],
      preferred: "codex",
      allowFallback: true,
      securityProfileId: "p",
      attachments: [],
    });
    expect(route.selected).toBeUndefined();
    expect(route.providers[0].reason).toBe("stale");
    expect(() =>
      assertRoute({ ...route, selected: "codex" }, "codex", "other"),
    ).toThrow(/not eligible/);
  });
  it("routes Grok text and run-scoped local documents while keeping images explicitly local", () => {
    const route = proposeRoute({
      capabilities: [
        { name: "grok", available: true, compatible: true, version: "1.0.3" },
      ],
      preferred: "grok",
      allowFallback: false,
      securityProfileId: "grok-profile",
      attachments: [
        { id: "text", mediaType: "text/plain", bytes: 1 },
        { id: "pdf", mediaType: "application/pdf", bytes: 1 },
        { id: "image", mediaType: "image/png", bytes: 1 },
      ],
    });
    expect(route).toMatchObject({ selected: "grok", eligible: ["grok"] });
    expect(
      route.providers.find((item) => item.provider === "grok"),
    ).toMatchObject({
      deliverableAttachmentIds: ["text", "pdf"],
      localOnlyAttachmentIds: ["image"],
    });
    expect(route.explanation.join(" ")).toMatch(
      /does not advertise image input.*images remain local/i,
    );
    expect(route.explanation.join(" ")).toContain(
      "integrity-checked run-scoped local file paths",
    );
  });
});
