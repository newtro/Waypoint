import { describe, expect, it } from "vitest";
import { decodePcm16MonoWav } from "./pcm-wav.js";

function chunk(id: string, data: Uint8Array): Uint8Array {
  const value = new Uint8Array(8 + data.length + (data.length % 2)),
    view = new DataView(value.buffer);
  for (let index = 0; index < 4; index++) value[index] = id.charCodeAt(index);
  view.setUint32(4, data.length, true);
  value.set(data, 8);
  return value;
}

function wav(...chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, value) => total + value.length, 12),
    value = new Uint8Array(size),
    view = new DataView(value.buffer);
  value.set([82, 73, 70, 70], 0);
  view.setUint32(4, size - 8, true);
  value.set([87, 65, 86, 69], 8);
  let offset = 12;
  for (const current of chunks) {
    value.set(current, offset);
    offset += current.length;
  }
  return value;
}

function format(): Uint8Array {
  const value = new Uint8Array(16),
    view = new DataView(value.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 16_000, true);
  view.setUint32(8, 32_000, true);
  view.setUint16(12, 2, true);
  view.setUint16(14, 16, true);
  return value;
}

describe("PCM WAV parsing", () => {
  it("accepts FFmpeg-style metadata chunks before audio data", () => {
    const pcm = new Uint8Array(4),
      pcmView = new DataView(pcm.buffer);
    pcmView.setInt16(0, -16384, true);
    pcmView.setInt16(2, 16384, true);
    const result = decodePcm16MonoWav(
      wav(chunk("fmt ", format()), chunk("LIST", new Uint8Array([1, 2, 3])), chunk("data", pcm)),
    );
    expect(result.sampleRate).toBe(16_000);
    expect([...result.samples]).toEqual([-0.5, 0.5]);
  });

  it("rejects truncated or non-mono PCM", () => {
    const invalidFormat = format();
    new DataView(invalidFormat.buffer).setUint16(2, 2, true);
    expect(() =>
      decodePcm16MonoWav(
        wav(chunk("fmt ", invalidFormat), chunk("data", new Uint8Array(4))),
      ),
    ).toThrow("voice_audio_invalid");
    expect(() => decodePcm16MonoWav(new Uint8Array(44))).toThrow(
      "voice_audio_invalid",
    );
  });
});
