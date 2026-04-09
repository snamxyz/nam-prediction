import { Elysia } from "elysia";
import { marketRoutes } from "./routes/markets";
import { portfolioRoutes } from "./routes/portfolio";
import { adminRoutes } from "./routes/admin";
import { startIndexer } from "./services/indexer";
import { startResolutionService } from "./services/resolution";

const PORT = Number(process.env.API_PORT) || 3001;

const app = new Elysia()
  // CORS for frontend
  .onBeforeHandle(({ set, request }) => {
    set.headers["Access-Control-Allow-Origin"] = "*";
    set.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    set.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";

    if (request.method === "OPTIONS") {
      set.status = 204;
      return "";
    }
  })
  // Health check
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))
  // API routes
  .use(marketRoutes)
  .use(portfolioRoutes)
  .use(adminRoutes)
  .listen(PORT);

console.log(`🔮 nam-prediction API running at http://localhost:${PORT}`);

// Start background services
startIndexer().catch((err) => console.error("[Indexer] Startup error:", err));
startResolutionService();

export type App = typeof app;
