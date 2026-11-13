import { NextResponse } from "next/server";
import { getProxyPools, deleteProxyPools, getProviderConnections, updateProxyPool } from "@/models";
import { testProxyUrl } from "@/lib/network/proxyTest.js";

export const dynamic = "force-dynamic";

// Global in-memory auto-scan daemon state
if (!global._autoProxyScannerState) {
  global._autoProxyScannerState = {
    running: false,
    intervalMinutes: 1, // default 1 minute
    timer: null,
    inCycle: false,
    lastRunAt: null,
    lastScanned: 0,
    lastPruned: 0,
    lastMessage: "Idle",
  };
}

const scannerState = global._autoProxyScannerState;

export async function executeAutoScanCycle() {
  if (scannerState.inCycle) return;
  scannerState.inCycle = true;
  scannerState.lastRunAt = new Date().toISOString();
  scannerState.lastMessage = "Scanning proxy pools health...";

  try {
    const [pools, connections] = await Promise.all([
      getProxyPools(),
      getProviderConnections(),
    ]);

    const boundIds = new Set(
      connections
        .map((c) => c?.providerSpecificData?.proxyPoolId)
        .filter(Boolean)
    );

    let deadCount = 0;
    const deadIds = [];

    // Test unbound proxies in parallel batches of 15
    const BATCH_SIZE = 15;
    for (let i = 0; i < pools.length; i += BATCH_SIZE) {
      if (!scannerState.running) break;
      const chunk = pools.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(async (pool) => {
          // If bound to an active provider connection, don't auto-delete blindly
          const isBound = boundIds.has(pool.id);

          try {
            const res = await testProxyUrl({
              proxyUrl: pool.proxyUrl,
              testUrl: "https://1.1.1.1/cdn-cgi/trace",
              timeoutMs: 2500,
            });

            if (!res?.ok) {
              if (!isBound) {
                deadIds.push(pool.id);
                deadCount += 1;
              } else {
                await updateProxyPool(pool.id, { testStatus: "error" });
              }
            } else {
              await updateProxyPool(pool.id, {
                testStatus: "ok",
                testLatency: res.latencyMs || null,
                lastTestedAt: new Date().toISOString(),
              });
            }
          } catch {
            if (!isBound) {
              deadIds.push(pool.id);
              deadCount += 1;
            }
          }
        })
      );
    }

    if (deadIds.length > 0) {
      await deleteProxyPools(deadIds);
    }

    scannerState.lastScanned = pools.length;
    scannerState.lastPruned = deadCount;
    scannerState.lastMessage = `Scan complete: Checked ${pools.length} proxies, auto-deleted ${deadCount} dead.`;
  } catch (err) {
    scannerState.lastMessage = `Scan error: ${err.message}`;
  } finally {
    scannerState.inCycle = false;
  }
}

function scheduleScanner() {
  if (scannerState.timer) {
    clearInterval(scannerState.timer);
    scannerState.timer = null;
  }
  if (scannerState.running && scannerState.intervalMinutes > 0) {
    const ms = scannerState.intervalMinutes * 60 * 1000;
    scannerState.timer = setInterval(() => {
      if (scannerState.running) {
        executeAutoScanCycle();
      }
    }, ms);
  }
}

/**
 * GET /api/proxy-pools/auto-scan
 * Get status of background auto-scan & prune worker
 */
export async function GET() {
  return NextResponse.json({
    running: scannerState.running,
    intervalMinutes: scannerState.intervalMinutes,
    lastRunAt: scannerState.lastRunAt,
    lastScanned: scannerState.lastScanned,
    lastPruned: scannerState.lastPruned,
    lastMessage: scannerState.lastMessage,
  });
}

/**
 * POST /api/proxy-pools/auto-scan
 * Configure, start, or stop auto-scan daemon
 */
export async function POST(request) {
  try {
    let body = {};
    try { body = await request.json(); } catch {}

    const { action, interval = 1 } = body;

    if (action === "stop") {
      scannerState.running = false;
      if (scannerState.timer) {
        clearInterval(scannerState.timer);
        scannerState.timer = null;
      }
      scannerState.lastMessage = "Auto-scanner paused.";
      return NextResponse.json({ success: true, running: false, message: scannerState.lastMessage });
    }

    const numericInterval = Math.max(1, Math.min(Number(interval) || 1, 1440));
    scannerState.intervalMinutes = numericInterval;
    scannerState.running = true;

    scheduleScanner();

    // Trigger first cycle asynchronously in background without blocking response
    setTimeout(() => {
      executeAutoScanCycle().catch((err) => {
        console.error("executeAutoScanCycle error:", err);
      });
    }, 100);

    return NextResponse.json({
      success: true,
      running: true,
      intervalMinutes: numericInterval,
      message: `Auto-scan active: Checking every ${numericInterval}m and auto-deleting dead proxies.`,
    });
  } catch (error) {
    console.error("Auto scan proxy error:", error);
    return NextResponse.json({ error: error?.message || "Failed to control auto scanner" }, { status: 500 });
  }
}
