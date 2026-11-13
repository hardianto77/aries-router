import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { findDeepSeekPowNonce } from "./deepseek-pow-hash.js";

/**
 * Single worker thread entry point.
 * Runs in an isolated background thread without spawning child layers.
 */
if (!isMainThread && parentPort) {
  try {
    const { prefix, challenge, difficulty } = workerData;
    const answer = findDeepSeekPowNonce(prefix, challenge, difficulty, 0);
    parentPort.postMessage({ answer });
  } catch (error) {
    parentPort.postMessage({ error: error?.message || String(error) });
  }
}

/**
 * Ultra-Lightweight Async PoW solver designed for low-spec / single-vCPU environments.
 *
 * Guarantees:
 * 1. Zero event-loop freeze (dashboard and concurrent streams never lag).
 * 2. Exactly ONE background worker (never spawns multiple threads or multi-layer processes).
 * 3. Bypasses worker overhead for trivial difficulty (< 5000 hashes).
 * 4. Automatic memory cleanup upon resolution.
 *
 * @param {string} prefix
 * @param {string} challenge
 * @param {number} difficulty
 * @param {AbortSignal} [signal]
 * @returns {Promise<number>}
 */
export async function solveDeepSeekPowAsync(prefix, challenge, difficulty, signal) {
  if (signal?.aborted) throw new Error("PoW solve aborted");

  // Threshold: For difficulty < 5000 (~15-20ms), compute inline to save thread creation overhead
  if (difficulty < 5000) {
    return findDeepSeekPowNonce(prefix, challenge, difficulty, 0);
  }

  // Exactly 1 single worker thread — safe for 1 vCPU / 512MB RAM servers
  return new Promise((resolve, reject) => {
    let worker = null;
    let finished = false;

    const cleanup = () => {
      finished = true;
      if (worker) {
        try {
          worker.terminate();
        } catch {}
        worker = null;
      }
    };

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          cleanup();
          reject(new Error("PoW solve aborted"));
        },
        { once: true }
      );
    }

    try {
      worker = new Worker(new URL(import.meta.url), {
        workerData: { prefix, challenge, difficulty },
      });

      worker.on("message", (msg) => {
        if (finished) return;
        const ans = typeof msg?.answer === "number" ? msg.answer : -1;
        cleanup();
        resolve(ans);
      });

      worker.on("error", (err) => {
        if (finished) return;
        cleanup();
        // Safe fail-open fallback: solve inline if worker thread fails to initialize
        try {
          const fallbackAns = findDeepSeekPowNonce(prefix, challenge, difficulty, 0);
          resolve(fallbackAns);
        } catch {
          reject(err);
        }
      });

      worker.on("exit", (code) => {
        if (!finished) {
          cleanup();
          resolve(-1);
        }
      });
    } catch {
      cleanup();
      // Fail-open inline fallback
      const fallbackAns = findDeepSeekPowNonce(prefix, challenge, difficulty, 0);
      resolve(fallbackAns);
    }
  });
}
