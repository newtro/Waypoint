import { describe, expect, it } from "vitest";
import { connect, createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENT_BROWSER_VERSION,
  browserArguments,
  browserClosureEntryNames,
  createBrowserNetworkGate,
  domainAllowed,
  publicAddress,
} from "./agent-browser.js";
import { EXPECTED_AGENT_BROWSER_CLOSURES } from "../generated-agent-browser-trust.js";
const base = {
  mode: "isolated" as const,
  session: "workspace_one",
  allowedDomains: ["example.com"],
  proxyUrl: "http://127.0.0.1:43123",
  browserExecutable: "/app/chromium",
};
describe("agent browser contract", () => {
  it("keeps each reviewed platform closure on an explicit finite digest list", () => {
    const mac = EXPECTED_AGENT_BROWSER_CLOSURES["darwin-arm64"],
      windows = EXPECTED_AGENT_BROWSER_CLOSURES["win32-x64"],
      digest = /^[a-f0-9]{64}$/;
    expect(mac.closureSha256).toHaveLength(2);
    expect(windows.closureSha256).toHaveLength(1);
    expect(
      [...mac.closureSha256, ...windows.closureSha256].every((value) =>
        digest.test(value),
      ),
    ).toBe(true);
    expect(mac.closureSha256).not.toContain("0".repeat(64));
    expect(windows.closureSha256).not.toContain("0".repeat(64));
  });
  it("pins the reviewed runtime and emits only modeled local flags", () => {
    expect(AGENT_BROWSER_VERSION).toBe("0.33.2");
    expect(
      browserArguments({
        ...base,
        action: { command: "snapshot", interactive: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        "--content-boundaries",
        "--allowed-domains",
        "example.com",
        "--headed",
        "snapshot",
        "-i",
      ]),
    );
  });
  it("enumerates every executable-closure file while excluding only its manifest", () => {
    const root = mkdtempSync(path.join(tmpdir(), "waypoint-browser-closure-"));
    mkdirSync(path.join(root, "nested"));
    writeFileSync(path.join(root, "manifest.json"), "{}");
    writeFileSync(path.join(root, "agent-browser.exe"), "agent");
    writeFileSync(path.join(root, "nested", "unexpected.dll"), "extra");
    expect([...browserClosureEntryNames(root)].sort()).toEqual(
      ["agent-browser.exe", path.join("nested", "unexpected.dll")].sort(),
    );
  });
  it("narrows navigation to the user policy and blocks schemes, credentials, unsafe selectors, and private profiles", () => {
    expect(domainAllowed("sub.example.com", ["*.example.com"])).toBe(true);
    expect(() =>
      browserArguments({
        ...base,
        action: { command: "open", url: "file:///etc/passwd" },
      }),
    ).toThrow("browser_url_denied");
    expect(() =>
      browserArguments({
        ...base,
        action: { command: "open", url: "https://evil.test" },
      }),
    ).toThrow("browser_url_denied");
    expect(
      browserArguments({ ...base, action: { command: "click", ref: "@e1" } }),
    ).toEqual(expect.arrayContaining(["click", "@e1"]));
    expect(() =>
      browserArguments({
        ...base,
        action: { command: "click", ref: "#password" },
      } as never),
    ).toThrow("browser_ref_invalid");
    expect(() =>
      browserArguments({
        ...base,
        mode: "existing",
        profileName: "Default",
        action: { command: "snapshot" },
      }),
    ).toThrow("browser_profile_snapshot_unavailable");
    expect(
      browserArguments({
        ...base,
        mode: "existing",
        profileName: "/managed/brave.Default",
        networkLockdownScript: "/app/browser-network-lockdown/lockdown.js",
        action: { command: "snapshot" },
      }),
    ).toEqual(
      expect.arrayContaining([
        "--profile",
        "/managed/brave.Default",
        "--init-script",
        "/app/browser-network-lockdown/lockdown.js",
      ]),
    );
  });
  it("rejects private and mapped network addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
    ])
      expect(publicAddress(address)).toBe(false);
    expect(publicAddress("93.184.216.34")).toBe(true);
    expect(publicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });
  it("destroys an established CONNECT tunnel when the gate closes", async () => {
    const upstream = createServer(() => {});
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === "string")
      throw new Error("fixture unavailable");
    const gate = await createBrowserNetworkGate(
        ["example.com"],
        async (domains) =>
          domains.map((domain) => ({ domain, address: "127.0.0.1" })),
        (() => connect(address.port, "127.0.0.1")) as typeof connect,
      ),
      port = Number(new URL(gate.url).port),
      client = connect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      client.once("error", reject);
      client.once("connect", () =>
        client.write(
          "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n",
        ),
      );
      client.once("data", () => resolve());
    });
    const closed = new Promise<void>((resolve) =>
      client.once("close", () => resolve()),
    );
    await gate.close();
    await closed;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    expect(client.destroyed).toBe(true);
  });
  it("models bounded interaction without raw flags", () => {
    expect(
      browserArguments({
        ...base,
        action: {
          command: "type",
          ref: "@e1",
          sensitive: false,
          text: "bounded input",
        },
      }),
    ).toEqual(expect.arrayContaining(["type", "@e1", "bounded input"]));
    expect(() =>
      browserArguments({
        ...base,
        action: {
          command: "type",
          ref: "@e1",
          sensitive: false,
          text: "x".repeat(4097),
        },
      }),
    ).toThrow("browser_text_invalid");
    expect(() =>
      browserArguments({
        ...base,
        action: { command: "wait", milliseconds: 30_001 },
      }),
    ).toThrow();
  });
});
