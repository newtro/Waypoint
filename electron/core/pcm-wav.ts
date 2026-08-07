const RIFF = 0x52494646;
const WAVE = 0x57415645;
const FMT = 0x666d7420;
const DATA = 0x64617461;

function invalid(): never {
  throw new Error("voice_audio_invalid");
}

export function decodePcm16MonoWav(bytes: Uint8Array): {
  samples: Float32Array;
  sampleRate: number;
} {
  if (bytes.byteLength < 44) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, false) !== RIFF ||
    view.getUint32(8, false) !== WAVE
  )
    invalid();

  let offset = 12;
  let format:
    | {
        audioFormat: number;
        channels: number;
        sampleRate: number;
        blockAlign: number;
        bitsPerSample: number;
      }
    | undefined;
  let dataOffset = -1,
    dataBytes = -1;
  while (offset + 8 <= bytes.byteLength) {
    const id = view.getUint32(offset, false),
      size = view.getUint32(offset + 4, true),
      chunkOffset = offset + 8,
      chunkEnd = chunkOffset + size;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength)
      invalid();
    if (id === FMT) {
      if (size < 16) invalid();
      format = {
        audioFormat: view.getUint16(chunkOffset, true),
        channels: view.getUint16(chunkOffset + 2, true),
        sampleRate: view.getUint32(chunkOffset + 4, true),
        blockAlign: view.getUint16(chunkOffset + 12, true),
        bitsPerSample: view.getUint16(chunkOffset + 14, true),
      };
    } else if (id === DATA && dataOffset < 0) {
      dataOffset = chunkOffset;
      dataBytes = size;
    }
    offset = chunkEnd + (size % 2);
  }

  if (
    !format ||
    format.audioFormat !== 1 ||
    format.channels !== 1 ||
    format.sampleRate < 8_000 ||
    format.sampleRate > 96_000 ||
    format.blockAlign !== 2 ||
    format.bitsPerSample !== 16 ||
    dataOffset < 0 ||
    dataBytes < 2 ||
    dataBytes % 2 ||
    dataOffset + dataBytes > bytes.byteLength
  )
    invalid();

  const samples = new Float32Array(dataBytes / 2);
  for (let index = 0; index < samples.length; index++)
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 32768;
  return { samples, sampleRate: format.sampleRate };
}
