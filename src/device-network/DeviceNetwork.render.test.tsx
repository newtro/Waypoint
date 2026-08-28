import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DeviceCard,
  type DeviceNetworkPeer,
} from "./DeviceNetwork.js";

const peer: DeviceNetworkPeer = {
  deviceId: "peer_device_00001",
  displayName: "Studio Mac",
  platform: "darwin",
  architecture: "arm64",
  appVersion: "1.0.0",
  fingerprintSha256: "a".repeat(64),
  status: "paused" as const,
  trusted: true,
  online: true,
  lastSeenAt: "2026-08-21T12:00:00.000Z",
  endpoint: "https://192.168.1.20:45000/",
  capabilities: ["presence", "pairing", "remote-work"],
  pauseWork: true,
  pauseSync: false,
  runningJobs: 1,
  attentionItems: 2,
  defaultMode: "supervised" as const,
};

function props(overrides: Partial<DeviceNetworkPeer> = {}) {
  return {
    peer: { ...peer, ...overrides },
    localVersion: "1.0.0",
    busy: false,
    onRequestPairing: vi.fn(),
    onConfirmPairing: vi.fn(),
    onUnlink: vi.fn(),
    onMode: vi.fn(),
  };
}

function findButton(node: ReactNode, label: string): (() => void) | undefined {
  if (!isValidElement(node)) return undefined;
  const value = node.props as {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  };
  if (
    node.type === "button" &&
    value.children === label &&
    !value.disabled
  )
    return value.onClick;
  const children = Array.isArray(value.children)
    ? value.children
    : [value.children];
  for (const child of children) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return undefined;
}

describe("DeviceCard", () => {
  it("renders real capabilities, independent pause state, work, and attention", () => {
    const html = renderToStaticMarkup(<DeviceCard {...props()} />);
    expect(html).toContain('aria-label="Device capabilities"');
    expect(html).toContain("Presence");
    expect(html).toContain("Pairing");
    expect(html).toContain("Remote work");
    expect(html).toContain("Remote work paused");
    expect(html).not.toContain("Sync paused");
    expect(html).toContain("1 running job");
    expect(html).toContain("2 items need attention");
  });

  it("keeps an idle compatible peer actionable and routes its click", () => {
    const input = props({
        status: "unlinked",
        trusted: false,
        capabilities: ["presence", "pairing"],
        pauseWork: false,
        runningJobs: 0,
        attentionItems: 0,
        defaultMode: undefined,
      }),
      element = DeviceCard(input),
      click = findButton(element, "Link this device");
    expect(click).toBeTypeOf("function");
    click?.();
    expect(input.onRequestPairing).toHaveBeenCalledWith(peer.deviceId);
  });
});
