import { describe, expect, it } from "vitest";
import { WaypointCrypto } from "./crypto.js";
import { openInboundWebhook, prepareSignedWebhook } from "./webhook-crypto.js";

describe("inbound webhook envelope validation", () => {
  it("rejects a decrypted payload with nested values before durable import", async () => {
    const crypto = await WaypointCrypto.create(), device = crypto.generateDevice("webhook_crypto_device_01"), signed = await prepareSignedWebhook({ channelId: "webhook_crypto_channel_01", secretVersion: 1, secret: "protected-test-secret", recipientPublicKey: device.encryptionPublicKey, eventType: "build.completed", payload: { nested: { bad: true } } as never });
    const envelope = JSON.parse(signed.body.toString("utf8")) as { ciphertextBase64: string };
    await expect(openInboundWebhook(envelope.ciphertextBase64, device.encryptionPublicKey, device.encryptionPrivateKey)).rejects.toThrow(/payload is invalid/);
  });
});
