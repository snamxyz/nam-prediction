import { Elysia } from "elysia";
import { marketRoutes } from "./routes/markets";
import { portfolioRoutes } from "./routes/portfolio";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { tradingRoutes } from "./routes/trading";
import { rangeMarketRoutes } from "./routes/range-markets";
import { startIndexer } from "./services/indexer";
import { startPositionReconciler } from "./services/position-reconciler";
import { startResolutionService } from "./services/resolution";
import { setupResolutionSchedule, startResolutionWorker } from "./services/queue/resolution-queue";
import { setupHourlySchedule, startHourlyWorker } from "./services/queue/hourly-queue";
import { setupNonceReconciliation, startNonceReconciliationWorker } from "./services/queue/nonce-reconciliation-queue";
import { setupLiquidityDrainSchedule, startLiquidityDrainWorker } from "./services/queue/liquidity-drain-queue";

import { initNonceManager } from "./lib/nonce-manager.instance";
import { featureFlags } from "./config/feature-flags";
import { initSocketIO } from "./ws/socket";
import { startNamPricePoller } from "./services/nam-price-poller";
import { createServer } from "http";
import { setupRangeMarketSchedule, startRangeMarketWorker, bootstrapVaultWhitelist } from "./services/queue/range-market-queue";
import { setupAdminSnapshotSchedule, startAdminSnapshotWorker } from "./services/queue/admin-snapshot-queue";
import { setupResolutionFallbackSchedule, startResolutionFallbackWorker } from "./services/queue/resolution-fallback-queue";
import { enabledWorkerNames, runtimeConfig } from "./config/runtime";

const PORT = Number(process.env.API_PORT) || 3001;

function setCorsHeaders(set: { headers: Record<string, string | number> }) {
  set.headers["Access-Control-Allow-Origin"] = "*";
  set.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  set.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
}

const app = new Elysia()
  // Handle OPTIONS preflight for every path
  .options("/*", ({ set }) => {
    setCorsHeaders(set);
    set.status = 204;
    return null;
  })
  // Attach CORS headers to every response
  .onAfterHandle(({ set }) => {
    setCorsHeaders(set);
  })
  // Health check
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))
  .get("/health/workers", () => ({
    status: "ok",
    runtime: {
      appEnv: runtimeConfig.appEnv,
      workerProfile: runtimeConfig.workerProfile,
      workerRole: runtimeConfig.workerRole,
      runWorkers: runtimeConfig.runWorkers,
    },
    enabledWorkers: enabledWorkerNames(),
    intervals: runtimeConfig.intervals,
  }))
  .get("/config", () => ({
    data: {
      contracts: {
        vaultAddress: process.env.VAULT_ADDRESS || null,
        rangeFactoryAddress: process.env.RANGE_FACTORY_ADDRESS || process.env.MARKET_FACTORY_ADDRESS || null,
      },
    },
  }))
  // API routes
  .use(marketRoutes)
  .use(tradingRoutes)
  .use(portfolioRoutes)
  .use(adminRoutes)
  .use(authRoutes)
  .use(rangeMarketRoutes);
  // NOTE: no `.listen(PORT)` here — Elysia's native server would bind the
  // port and swallow the HTTP upgrade requests that Socket.IO needs. We
  // host HTTP + WebSocket together through the Node http.Server below so
  // they share a single port.

// Node http.Server bridges Elysia's fetch handler *and* Socket.IO.
// Socket.IO attaches an "upgrade" listener to this server, so WebSocket
// handshakes on `/socket.io/*` go to Socket.IO and everything else is
// forwarded to Elysia.
const httpServer = createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host || "localhost"}${req.url || "/"}`;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const fetchReq = new Request(url, {
      method: req.method,
      headers: req.headers as any,
      body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    });

    const response = await app.handle(fetchReq);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const ab = await response.arrayBuffer();
    res.end(Buffer.from(ab));
  } catch (err) {
    console.error("[HTTP] bridge error:", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

initSocketIO(httpServer);

httpServer.listen(PORT, () => {
  console.log(`🔮 nam-prediction API running at http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO listening on ws://localhost:${PORT}/socket.io/`);
  console.log(
    `[Features] AMM=${featureFlags.enableAmmTrading} CLOB=${featureFlags.enableClobTrading} default=${featureFlags.defaultMarketExecutionMode}`
  );
  console.log(
    `[Runtime] env=${runtimeConfig.appEnv} workerProfile=${runtimeConfig.workerProfile} role=${runtimeConfig.workerRole} runWorkers=${runtimeConfig.runWorkers}`
  );
  console.log(`[Runtime] enabledWorkers=${enabledWorkerNames().join(", ") || "none"}`);
});

// Start NAM price poller (feeds WebSocket updates + HTTP cache)
if (runtimeConfig.workers.namPricePoller) {
  startNamPricePoller();
} else {
  console.log("[NAMPrice] Poller disabled by runtime config");
}

// Start background services
if (runtimeConfig.workers.nonceManager) {
  initNonceManager()
    .then(() => {
      console.log("[NonceManager] Initialized successfully");
      // Whitelist any active range-market CPMM pools that were missed (e.g. created
      // before the vault was deployed, or whose on-creation whitelist tx failed).
      if (!runtimeConfig.workers.vaultWhitelistBootstrap) return undefined;
      return bootstrapVaultWhitelist();
    })
    .then(() => {
      if (runtimeConfig.workers.vaultWhitelistBootstrap) {
        console.log("[VaultWhitelist] Bootstrap complete");
      }
    })
    .catch((err) => console.error("[NonceManager/VaultWhitelist] Init error:", err));
} else {
  console.log("[NonceManager] Disabled by runtime config");
}

if (runtimeConfig.workers.indexer) {
  startIndexer({ startPriceReconciler: runtimeConfig.workers.priceReconciler }).catch((err) =>
    console.error("[Indexer] Startup error:", err)
  );
} else {
  console.log("[Indexer] Disabled by runtime config");
}

// Defense-in-depth for share-balance drift (see services/position-reconciler.ts).
// Runtime config decides whether this safety sweep runs and how often.
if (runtimeConfig.workers.positionReconciler) {
  startPositionReconciler();
} else {
  console.log("[Reconciler] Position reconciler disabled by runtime config");
}

if (runtimeConfig.workers.resolutionPoller) {
  startResolutionService();
} else {
  console.log("[Resolution] Poller disabled by runtime config");
}

// Start BullMQ resolution worker + schedule
if (runtimeConfig.workers.dailyResolution) {
  setupResolutionSchedule().catch((err) => console.error("[BullMQ] Schedule setup error:", err));
  startResolutionWorker();
} else {
  console.log("[BullMQ] Daily resolution worker disabled by runtime config");
}

// Start nonce reconciliation (every 30s)
if (runtimeConfig.workers.nonceReconciliation) {
  setupNonceReconciliation().catch((err) => console.error("[BullMQ] Nonce reconciliation setup error:", err));
  startNonceReconciliationWorker();
} else {
  console.log("[BullMQ] Nonce reconciliation disabled by runtime config");
}

// Liquidity-breaker: drain excess USDC from resolved AMM pools to the treasury.
if (runtimeConfig.workers.liquidityDrain) {
  setupLiquidityDrainSchedule().catch((err) => console.error("[LiquidityDrain] Schedule setup error:", err));
  startLiquidityDrainWorker();
} else {
  console.log("[LiquidityDrain] Worker disabled by runtime config");
}

// Start dedicated BullMQ 24h market lifecycle worker (lock + resolve + create)
if (runtimeConfig.workers.hourlyMarkets) {
  setupHourlySchedule().catch((err) => console.error("[24h] Schedule setup error:", err));
  startHourlyWorker();
} else {
  console.log("[24h] 24h markets disabled by runtime config");
}

// Start range market lifecycle worker (daily receipts; participants/NAM-distribution optional)
if (runtimeConfig.workers.rangeMarkets) {
  setupRangeMarketSchedule().catch((err) => console.error("[RangeMarket] Schedule setup error:", err));
  startRangeMarketWorker();
} else {
  console.log("[RangeMarket] Range markets disabled by runtime config");
}

// Fallback reconciler: re-resolves on-chain any market that is resolved in the
// DB but whose contract state still shows unresolved.
if (runtimeConfig.workers.resolutionFallback) {
  setupResolutionFallbackSchedule().catch((err) =>
    console.error("[ResolutionFallback] Schedule setup error:", err)
  );
  startResolutionFallbackWorker();
} else {
  console.log("[ResolutionFallback] Worker disabled by runtime config");
}

// Keep Redis admin read models warm for dashboard liquidity and holdings views.
if (runtimeConfig.workers.adminSnapshots) {
  if (runtimeConfig.workers.adminSnapshotSchedule) {
    setupAdminSnapshotSchedule().catch((err) => console.error("[AdminSnapshots] Schedule setup error:", err));
  } else {
    console.log("[AdminSnapshots] Repeatable schedule disabled; event-driven refresh only");
  }
  startAdminSnapshotWorker();
} else {
  console.log("[AdminSnapshots] Worker disabled by runtime config");
}

export type App = typeof app;
