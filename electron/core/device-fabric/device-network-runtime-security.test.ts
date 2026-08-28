import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  isAllowedLanRequest,
  PairingAdmissionGate,
  readBytes,
  validHostBindAddress,
} from "./device-network-runtime.js";

const interfaces = {
  Ethernet: [
    {
      address: "192.168.10.20",
      netmask: "255.255.255.0",
      family: "IPv4" as const,
      mac: "00:11:22:33:44:55",
      internal: false,
      cidr: "192.168.10.20/24",
    },
  ],
};

describe("Device Host network admission", () => {
  it("accepts loopback and the same private subnet but rejects public and unrelated paths", () => {
    expect(isAllowedLanRequest("::1", interfaces)).toBe(true);
    expect(isAllowedLanRequest("::ffff:192.168.10.44", interfaces)).toBe(true);
    expect(isAllowedLanRequest("192.168.11.44", interfaces)).toBe(false);
    expect(isAllowedLanRequest("10.8.0.2", interfaces)).toBe(false);
    expect(isAllowedLanRequest("8.8.8.8", interfaces)).toBe(false);
    expect(isAllowedLanRequest(undefined, interfaces)).toBe(false);
    expect(validHostBindAddress("127.0.0.1")).toBe(true);
    expect(validHostBindAddress("192.168.10.20")).toBe(true);
    expect(validHostBindAddress("0.0.0.0")).toBe(false);
    expect(validHostBindAddress("8.8.8.8")).toBe(false);
    expect(validHostBindAddress("239.255.87.80")).toBe(false);
  });

  it("destroys a stream at the first byte beyond the body bound", async () => {
    const stream = new PassThrough(),
      result = readBytes(stream, 4);
    stream.write(Buffer.alloc(5));
    await expect(result).rejects.toThrow(/too large/);
    expect(stream.destroyed).toBe(true);
  });

  it("bounds total pairing sessions and rate limits each source", () => {
    const gate = new PairingAdmissionGate();
    for (let index = 0; index < 12; index += 1)
      gate.admitRequest("192.168.10.44", 1_000);
    expect(() =>
      gate.admitRequest("192.168.10.44", 1_000),
    ).toThrow(/rate limited/);

    const capacity = new PairingAdmissionGate();
    expect(() => capacity.admitCapacity(32, false)).toThrow(
      /capacity/,
    );
    expect(() => capacity.admitCapacity(32, true)).not.toThrow();
  });
});
