import { Elysia } from "elysia";
import { marketRoutes } from "./routes/markets";
import { portfolioRoutes } from "./routes/portfolio";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { orderRoutes } from "./routes/orders";
import { startIndexer } from "./services/indexer";
import { startResolutionService } from "./services/resolution";
import { setupResolutionSchedule, startResolutionWorker } from "./services/queue/resolution-queue";
import { featureFlags } from "./config/feature-flags";
import { hasActiveM15Market, createNextM15Market } from "./services/m15-market";

const ENABLE_M15_MARKETS = (() => {
  const v = (process.env.ENABLE_M15_MARKETS || "").trim().toLowerCase();
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
  // API routes
  .use(marketRoutes)
  .use(orderRoutes)
  .use(portfolioRoutes)
  .use(adminRoutes)
  .use(authRoutes)
  .listen(PORT);

console.log(`🔮 nam-prediction API running at http://localhost:${PORT}`);
console.log(
  `[Features] AMM=${featureFlags.enableAmmTrading} CLOB=${featureFlags.enableClobTrading} default=${featureFlags.defaultMarketExecutionMode}`
);

// Start background services
startIndexer().catch((err) => console.error("[Indexer] Startup error:", err));
startResolutionService();

// Start BullMQ resolution worker + schedule
setupResolutionSchedule().catch((err) => console.error("[BullMQ] Schedule setup error:", err));
startResolutionWorker();

// Ensure an active m15 market exists on startup
if (ENABLE_M15_MARKETS) {
  hasActiveM15Market().then(async (active) => {
    if (!active) {
      console.log("[M15] No active m15 market found on startup — creating one");
      try {
        await createNextM15Market();
        console.log("[M15] Startup market created");
      } catch (err) {
        console.error("[M15] Failed to create startup market:", err);
      }
    } else {
      console.log("[M15] Active m15 market already exists");
    }
  }).catch((err) => console.error("[M15] Startup check error:", err));
} else {
  console.log("[M15] m15 markets disabled (set ENABLE_M15_MARKETS=true to enable)");
}

export type App = typeof app;
