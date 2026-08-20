import { createRequire } from "node:module";
import path from "node:path";

const [runtimeRoot, modelRoot, threadsValue] = process.argv.slice(2),
  threads = Number(threadsValue),
  require = createRequire(path.join(runtimeRoot, "package.json")),
  runtime = require("sherpa-onnx-node"),
  started = performance.now(),
  engine = await runtime.OfflineTts.createAsync({
    model: {
      kitten: {
        model: path.join(modelRoot, "model.fp16.onnx"),
        voices: path.join(modelRoot, "voices.bin"),
        tokens: path.join(modelRoot, "tokens.txt"),
        dataDir: path.join(modelRoot, "espeak-ng-data"),
        lengthScale: 1,
      },
    },
    maxNumSentences: 1,
    numThreads: threads,
    provider: "cpu",
  }),
  loaded = performance.now(),
  result = await engine.generateAsync({
    text: "Waypoint is ready to help.",
    sid: 0,
    speed: 1,
    enableExternalBuffer: false,
  });
console.log(
  JSON.stringify({
    threads,
    loadMs: loaded - started,
    totalMs: performance.now() - started,
    samples: result.samples.length,
    sampleRate: result.sampleRate,
  }),
);
