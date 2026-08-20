import { describe, expect, it } from "vitest";
import {
  autoTitleMayStart,
  localChatTitle,
  minimalTitlePrompt,
  normalizeGeneratedTitle,
  privacySafeTitleSeed,
  resolveAutomaticTitle,
} from "./auto-chat-title.js";

describe("automatic chat titles", () => {
  it("creates a bounded deterministic local fallback", () =>
    expect(
      localChatTitle(
        "Help me plan a careful Windows acceptance test for Waypoint, please!",
      ),
    ).toBe("Help me plan a careful Windows acceptance test"));
  it("normalizes provider output without accepting multiline content", () => {
    expect(normalizeGeneratedTitle(' "Windows Acceptance Plan" ')).toBe(
      "Windows Acceptance Plan",
    );
    expect(normalizeGeneratedTitle("one\ntwo")).toBeUndefined();
  });
  it("fails closed for common secret forms and sends only bounded safe topic text", async () => {
    for (const raw of [
      "password: hunter2",
      "Authorization: Basic abc",
      "AKIA1234567890123456",
      "-----BEGIN PRIVATE KEY-----",
      "user@example.com",
      "/Users/alice/client.txt",
      '"quoted client payload"',
      "```private code```",
    ]) {
      expect(privacySafeTitleSeed(raw)).toBe("Private conversation");
      await expect(
        resolveAutomaticTitle({
          user: raw,
          signal: new AbortController().signal,
          claude: async () => {
            throw new Error("must not run");
          },
        }),
      ).resolves.toMatchObject({
        lane: "local",
        title: "Private conversation",
      });
    }
    const prompt = minimalTitlePrompt(
      "Plan https://private.example Tool: raw tool output " + "u".repeat(900),
    );
    expect(prompt.length).toBeLessThan(500);
    expect(prompt).not.toMatch(/private\.example|raw tool output/);
    expect(privacySafeTitleSeed("Attachment: private.pdf")).toContain(
      "[output omitted]",
    );
  });
  it("prefers Claude, then Grok, falls through failed/capped hosted lanes, and always has a local result", async () => {
    const signal = new AbortController().signal;
    await expect(
      resolveAutomaticTitle({
        user: "Local title source",
        signal,
        claude: async () => ({ text: "Claude Title", model: "fable" }),
        grok: async () => ({ text: "unused", model: "grok-4.6" }),
        openrouter: async () => ({ text: "unused", model: "nano" }),
      }),
    ).resolves.toMatchObject({ lane: "claude", title: "Claude Title" });
    await expect(
      resolveAutomaticTitle({
        user: "Local title source",
        signal,
        claude: async () => {
          throw new Error("unavailable");
        },
        grok: async () => ({ text: "Grok Title", model: "grok-4.6" }),
      }),
    ).resolves.toMatchObject({ lane: "grok", title: "Grok Title" });
    await expect(
      resolveAutomaticTitle({
        user: "Local title source",
        signal,
        claude: async () => {
          throw new Error("unavailable");
        },
        grok: async () => {
          throw new Error("unavailable");
        },
        openrouter: async () => {
          throw new Error("cap");
        },
      }),
    ).resolves.toMatchObject({ lane: "local", title: "Local title source" });
  });
  it("keeps global Stop fail closed until policy resumes", () => {
    expect(autoTitleMayStart(true)).toBe(false);
    expect(autoTitleMayStart(false)).toBe(true);
  });
});
