import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import { redisSub } from "../lib/redis";

let io: SocketIOServer | null = null;

// ─── Redis pub/sub channels ───
const CHANNELS = {
  MARKET_PRICE: "market:price",
  TRADE_NEW: "trade:new",
  MARKET_RESOLVED: "market:resolved",
  MARKET_LOCKED: "market:locked",
  MARKET_UPDATE: "market:update",
  USER_BALANCE: "user:balance",
  USER_SHARES: "user:shares",
  NAM_PRICE: "nam:price",
} as const;

export function getIO(): SocketIOServer {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    // Join market room
    socket.on("join:market", (marketId: number) => {
      socket.join(`market:${marketId}`);
    });

    // Leave market room
    socket.on("leave:market", (marketId: number) => {
      socket.leave(`market:${marketId}`);
    });

    // Join user room
    socket.on("join:user", (walletAddress: string) => {
      socket.join(`user:${walletAddress.toLowerCase()}`);
    });

    // Leave user room
    socket.on("leave:user", (walletAddress: string) => {
      socket.leave(`user:${walletAddress.toLowerCase()}`);
    });

    socket.on("disconnect", () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  // Subscribe to Redis pub/sub and fan out to Socket.IO rooms
  subscribeToRedis();

  console.log("[WS] Socket.IO initialized");
  return io;
}

function subscribeToRedis() {
  const channels = Object.values(CHANNELS);
  redisSub.subscribe(...channels, (err) => {
    if (err) {
      console.error("[WS] Redis subscribe error:", err);
      return;
    }
    console.log(`[WS] Subscribed to Redis channels: ${channels.join(", ")}`);
  });

  redisSub.on("message", (channel, message) => {
    if (!io) return;

    try {
      const data = JSON.parse(message);

      switch (channel) {
        case CHANNELS.MARKET_PRICE:
        case CHANNELS.MARKET_UPDATE:
        case CHANNELS.MARKET_LOCKED:
        case CHANNELS.MARKET_RESOLVED:
        case CHANNELS.TRADE_NEW:
          // Broadcast to market room
          if (data.marketId != null) {
            io.to(`market:${data.marketId}`).emit(channel, data);
          }
          break;

        case CHANNELS.USER_BALANCE:
        case CHANNELS.USER_SHARES:
          // Broadcast to user room
          if (data.wallet) {
            io.to(`user:${data.wallet.toLowerCase()}`).emit(channel, data);
          }
          break;

        case CHANNELS.NAM_PRICE:
          // Broadcast NAM price updates to all connected clients
          io.emit("nam:price", data);
          break;
      }
    } catch (err) {
      console.error(`[WS] Error processing message on ${channel}:`, err);
    }
  });
}
