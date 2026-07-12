import { parentPort, workerData } from "node:worker_threads";
import { scanRepo, type ScanOptions } from "./scanner.js";

interface WorkerInput {
  rootPath: string;
  options: ScanOptions;
}

if (!parentPort) throw new Error("scanner worker must run inside a worker thread");

try {
  const input = workerData as WorkerInput;
  const serializable = { ...scanRepo(input.rootPath, input.options) };
  delete (serializable as Partial<typeof serializable>).hasFile;
  delete (serializable as Partial<typeof serializable>).hasDir;
  parentPort.postMessage({ ok: true, signals: serializable });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
