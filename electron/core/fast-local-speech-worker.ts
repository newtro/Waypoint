import { createRequire } from "node:module";
import path from "node:path";

type Tts = {
  sampleRate: number;
  numSpeakers: number;
  generateAsync(input: {
    text: string;
    sid: number;
    speed: number;
    enableExternalBuffer?: boolean;
  }): Promise<{ samples: Float32Array; sampleRate: number }>;
};

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error("voice_worker_root_invalid");
const require = createRequire(import.meta.url),
  runtime = require("sherpa-onnx-node") as {
    OfflineTts: { createAsync(config: Record<string, unknown>): Promise<Tts> };
  },
  send = (value: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send
        ? process.send(value, (error) => (error ? reject(error) : resolve()))
        : reject(new Error("voice_worker_ipc_missing")),
    ),
  engine = await runtime.OfflineTts.createAsync({
    model: {
      kitten: {
        model: path.join(root, "model.fp16.onnx"),
        voices: path.join(root, "voices.bin"),
        tokens: path.join(root, "tokens.txt"),
        dataDir: path.join(root, "espeak-ng-data"),
        lengthScale: 1,
      },
    },
    maxNumSentences: 1,
    numThreads: 4,
    provider: "cpu",
  }),
  ready = engine.sampleRate > 8_000 && engine.numSpeakers > 0;

if (process.argv[3] === "--probe") {
  await send({ type: "probe", ready });
  process.disconnect?.();
} else {
  await send({ type: "ready", ready });
  process.on("message", (value) => {
    void (async () => {
      const request = value as { type?: string; id?: number; text?: string };
      if (
        request.type !== "speak" ||
        !Number.isInteger(request.id) ||
        typeof request.text !== "string" ||
        !request.text ||
        request.text.length > 200_000
      ) {
        await send({ type: "failed", id: request.id });
        return;
      }
      try {
        const result = await engine.generateAsync({
          text: request.text,
          sid: 0,
          speed: 1,
          enableExternalBuffer: false,
        });
        if (!result.samples.length) throw new Error("voice_worker_empty");
        await send({
          type: "audio",
          id: request.id,
          samples: new Float32Array(result.samples),
          sampleRate: result.sampleRate,
        });
      } catch {
        await send({ type: "failed", id: request.id });
      }
    })();
  });
}
