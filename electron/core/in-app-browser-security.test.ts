import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inAppBrowserWebPreferences } from "./in-app-browser.js";

describe("embedded browser direct-network containment", () => {
  it("keeps renderer privilege off and disables proxy-bypassing transports", () => {
    expect(inAppBrowserWebPreferences("fixture")).toMatchObject({
      partition: "fixture",
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: false,
      disableBlinkFeatures: "WebRTC,WebTransport,DirectSockets",
    });
  });
  it("stops the WebContents and rejects late completion when a run aborts", () => {
    const source = readFileSync(new URL("./in-app-browser.ts", import.meta.url), "utf8");
    expect(source).toContain('entry.view.webContents.stop()');
    expect(source).toContain('return Promise.reject(new DOMException("Canceled", "AbortError"))');
    expect(source).toContain('finish(() => reject(new DOMException("Canceled", "AbortError")))');
    expect(source).toContain('await run(() => wc.loadURL');
    expect(source).toContain('await run(() => this.evaluate(entry');
    expect(source).toContain('await run(() => wc.capturePage())');
  });
  it("disables non-proxied WebRTC UDP and QUIC before Electron starts", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    expect(main).toContain('"force-webrtc-ip-handling-policy"');
    expect(main).toContain('"disable_non_proxied_udp"');
    expect(main).toContain('appendSwitch("disable-quic")');
  });
});
