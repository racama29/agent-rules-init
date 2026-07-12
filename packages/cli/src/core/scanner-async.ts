import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { RepoSignals } from "./types.js";
import type { ScanOptions } from "./scanner.js";

type SerializableSignals = Omit<RepoSignals, "hasFile" | "hasDir">;
type WorkerMessage = { ok: true; signals: SerializableSignals } | { ok: false; error: string };

function restoreSignals(signals: SerializableSignals): RepoSignals {
  const normalizedFiles = new Set(signals.files.map((file) => file.split(path.sep).join("/")));
  return {
    ...signals,
    hasFile: (relativePath) => normalizedFiles.has(relativePath.split(path.sep).join("/")),
    hasDir: (relativeDir) => {
      try {
        return fs.statSync(path.join(signals.rootPath, relativeDir)).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

/** Runs full repository discovery off the main event loop in the published CLI. */
export function scanRepoInWorker(rootPath: string, options: ScanOptions = {}, timeoutMs = 30_000): Promise<RepoSignals> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(new URL("./scanner-worker.js", import.meta.url), {
      workerData: { rootPath, options },
    });
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(() => reject(new Error(`repository scanner worker timed out after ${timeoutMs / 1000}s`)));
    }, timeoutMs);
    worker.once("message", (message: WorkerMessage) => {
      finish(() => {
        if (message.ok) {
          const restored = restoreSignals(message.signals);
          if (restored.scanStats) restored.scanStats.mode = "worker";
          resolve(restored);
        } else reject(new Error(`repository scanner worker failed: ${message.error}`));
      });
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(new Error(`repository scanner worker exited with code ${code}`)));
    });
  });
}
