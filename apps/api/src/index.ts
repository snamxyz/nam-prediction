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

const ENABLE_24H_MARKETS = (() => {
  const v = (process.env.ENABLE_24H_MARKETS || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
})();

const ENABLE_RANGE_MARKETS = (() => {
  const v = (process.env.ENABLE_RANGE_MARKETS || "true").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
})();

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
  .get("/config", () => ({
    data: {
      contracts: {
        vaultAddress: process.env.VAULT_ADDRESS || null,
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
});

// Start NAM price poller (feeds WebSocket updates + HTTP cache)
startNamPricePoller();

// Start background services
initNonceManager()
  .then(() => {
    console.log("[NonceManager] Initialized successfully");
    // Whitelist any active range-market CPMM pools that were missed (e.g. created
    // before the vault was deployed, or whose on-creation whitelist tx failed).
    return bootstrapVaultWhitelist();
  })
  .then(() => console.log("[VaultWhitelist] Bootstrap complete"))
  .catch((err) => console.error("[NonceManager/VaultWhitelist] Init error:", err));
startIndexer().catch((err) => console.error("[Indexer] Startup error:", err));
// Defense-in-depth for the share-balance double-count bug (see
// services/position-reconciler.ts). Runs every 30s and heals any DB row
// whose share balance has drifted from the on-chain OutcomeToken.balanceOf.
startPositionReconciler();
startResolutionService();

// Start BullMQ resolution worker + schedule
setupResolutionSchedule().catch((err) => console.error("[BullMQ] Schedule setup error:", err));
startResolutionWorker();

// Start nonce reconciliation (every 30s)
setupNonceReconciliation().catch((err) => console.error("[BullMQ] Nonce reconciliation setup error:", err));
startNonceReconciliationWorker();

// Liquidity-breaker: drain excess USDC from resolved AMM pools to the treasury.
setupLiquidityDrainSchedule().catch((err) => console.error("[LiquidityDrain] Schedule setup error:", err));
startLiquidityDrainWorker();

// Start dedicated BullMQ 24h market lifecycle worker (lock + resolve + create)
if (ENABLE_24H_MARKETS) {
  setupHourlySchedule().catch((err) => console.error("[24h] Schedule setup error:", err));
  startHourlyWorker();
} else {
  console.log("[24h] 24h markets disabled (set ENABLE_24H_MARKETS=true to enable)");
}

// Start range market lifecycle worker (daily receipts; participants/NAM-distribution optional)
if (ENABLE_RANGE_MARKETS) {
  setupRangeMarketSchedule().catch((err) => console.error("[RangeMarket] Schedule setup error:", err));
  startRangeMarketWorker();
} else {
  console.log("[RangeMarket] Range markets disabled (set ENABLE_RANGE_MARKETS=false to disable)");
}

// Keep Redis admin read models warm for dashboard liquidity and holdings views.
setupAdminSnapshotSchedule().catch((err) => console.error("[AdminSnapshots] Schedule setup error:", err));
startAdminSnapshotWorker();

export type App = typeof app;
