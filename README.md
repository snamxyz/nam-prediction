# nam-prediction

A prediction market platform for the NAM token on Base, built as a Turbo monorepo. Users trade YES/NO outcome tokens on rolling 1-hour and daily markets, with fully on-chain settlement via a Constant Product Market Maker (CPMM).

## Architecture

```
nam-prediction/
├── apps/
│   ├── api/        # ElysiaJS backend — markets, trades, resolution, indexer, REST + Socket.IO
│   └── web/        # Next.js 15 frontend — trading UI, portfolio, market pages
└── packages/
    ├── contracts/  # Solidity contracts (MarketFactory, CPMM, OutcomeToken) + Hardhat
    └── shared/     # Shared TypeScript types & utilities
```

### Tech stack

- **Runtime:** Bun 1.2
- **Monorepo:** Turborepo + Bun workspaces
- **Frontend:** Next.js 15, React 19, Tailwind, wagmi/viem, Privy (embedded wallets), Recharts
- **Backend:** ElysiaJS, Socket.IO, Drizzle ORM, PostgreSQL (Neon), Redis, BullMQ
- **Smart contracts:** Solidity, Hardhat, OpenZeppelin, deployed on **Base** (chain id 8453)
- **Price feed:** DexScreener NAM/USDC pair

## How it works

The platform runs rolling **1-hour AMM markets**. Each market asks *"Will NAM be >= $X at T+1h?"*. Trading happens fully on-chain through `CPMM.sol` with a configurable fee (default 2%). When one market resolves, the next is created automatically using the current price as threshold.

Resolution polls DexScreener every 60s and settles via `MarketFactory.resolveMarket()` on Base. Winners redeem 1:1 USDC per outcome token through `MarketFactory.redeem()`.

See [`prediction-market-rundown.txt`](./prediction-market-rundown.txt) for the full step-by-step flow (market creation → trade → indexer → resolution → redemption).

## Getting started

### Prerequisites

- [Bun](https://bun.sh) >= 1.2
- PostgreSQL database (local or Neon)
- Redis (local or Railway/Upstash)
- A Base RPC endpoint
- A Privy app (for embedded wallets)

### Install

```bash
bun install
```

### Environment

Copy `.env` at the repo root and fill in the values. Key variables:

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Base RPC endpoint |
| `PRIVATE_KEY` | Deployer / admin wallet (with `0x` prefix) |
| `USDC_ADDRESS` | USDC token on Base (`0x8335...2913`) |
| `MARKET_FACTORY_ADDRESS` | Deployed `MarketFactory` address |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `API_PORT` | Backend port (default `3001`) |
| `ADMIN_ADDRESSES` | Comma-separated admin wallets |
| `DEXSCREENER_PAIR_ADDRESS` | NAM/USDC pair on Base |
| `RESOLUTION_POLL_INTERVAL` | Resolution poll interval in ms (default `60000`) |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | Privy server auth |
| `NEXT_PUBLIC_*` | Frontend-exposed public vars |

Worker/runtime controls:

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_ENV` | `dev` unless `NODE_ENV`/`VERCEL_ENV` imply otherwise | Runtime environment (`dev`, `staging`, `prod`) |
| `WORKER_PROFILE` | Same as `APP_ENV` | Chooses safe default worker intervals and enabled workers |
| `RUN_WORKERS` | `false` outside prod, `true` in prod | Master switch for background workers and recurring pollers |
| `WORKER_ROLE` | `all` | Use `api` for HTTP-only processes, `workers` or `all` for background work |
| `ENABLE_INDEXER` | Follows `RUN_WORKERS` | Enables chain event watchers |
| `ENABLE_PRICE_RECONCILER` | Follows `RUN_WORKERS` | Enables slower price drift safety sweep |
| `ENABLE_POSITION_RECONCILER` | Follows `RUN_WORKERS` | Enables position balance safety sweep |
| `ENABLE_RESOLUTION_POLLER` | Follows `RUN_WORKERS` | Enables legacy API-source resolution polling |
| `ENABLE_LIQUIDITY_DRAIN_WORKER` | Follows `RUN_WORKERS` | Enables resolved-market liquidity drain sweeps |
| `ENABLE_NONCE_RECONCILIATION` | Follows `RUN_WORKERS` | Enables nonce safety reconciliation |
| `ENABLE_NAM_PRICE_POLLER` | Follows `RUN_WORKERS` | Enables recurring DexScreener price polling and socket broadcasts |
| `ENABLE_ADMIN_SNAPSHOT_WORKER` | Follows `RUN_WORKERS` | Processes event-driven admin snapshot refresh jobs |
| `ENABLE_ADMIN_SNAPSHOT_SCHEDULE` | `true` only in prod worker profile | Enables slow fallback admin snapshot refresh cron |
| `ENABLE_RANGE_MARKETS` | `true` only in prod worker profile | Enables range lifecycle worker |
| `ENABLE_24H_MARKETS` | `true` only in prod worker profile | Enables 24h lifecycle worker |
| `ADMIN_SNAPSHOT_INTERVAL_MS` | 10-15 minutes by profile | Fallback admin snapshot refresh cadence |
| `RANGE_MARKET_CATCHUP_MS` / `HOURLY_MARKET_CATCHUP_MS` | 10-15 minutes by profile | Lifecycle catch-up sweeps; delayed jobs handle timely resolution |

For local development against Neon, keep `RUN_WORKERS=false` or omit it. This starts the API routes without recurring DB workers so Neon can autosuspend when you stop making requests. Use `RUN_WORKERS=true WORKER_PROFILE=prod` only when you intentionally want to test the full background system locally.

Feature flags:

| Flag | Default | Purpose |
| --- | --- | --- |
| `ENABLE_HOURLY_MARKETS` | `false` | Auto-create rolling 1-hour markets |
| `HOURLY_MARKET_DURATION_MINUTES` | `60` | Market duration |
| `MARKET_LOCK_WINDOW_SECONDS` | `10` | Lock window before end |
| `DEFAULT_FEE_BPS` | `200` | CPMM trading fee (2%) |
| `HOURLY_MARKET_LIQUIDITY` | `1` | Seed USDC per hourly market |
| `DAILY_MARKET_LIQUIDITY` | `100` | Seed USDC per daily market |

> **Never commit real secrets.** The committed `.env` is for local development only — rotate any shared keys before going to production.

### Database

```bash
cd apps/api
bun run db:push        # push the Drizzle schema
bun run db:studio      # optional: open Drizzle Studio
```

### Run everything (dev)

From the repo root:

```bash
bun run dev
```

Turbo will start all apps in parallel. Or run a single app:

```bash
bun --filter @nam-prediction/api dev
bun --filter @nam-prediction/web dev
```

Default ports:

- Web: http://localhost:3000
- API: http://localhost:3001

### Smart contracts

```bash
cd packages/contracts
bun run build                 # hardhat compile
bun run test                  # hardhat test
bun run deploy:base           # deploy to Base mainnet
```

After deployment, update `MARKET_FACTORY_ADDRESS` and `NEXT_PUBLIC_MARKET_FACTORY_ADDRESS` in `.env`.

### Create a 1-hour market manually

```bash
cd apps/api
bun run market:create:hourly
```

## Scripts

Run from the repo root with Turbo:

| Command | Description |
| --- | --- |
| `bun run dev` | Start all apps in watch mode |
| `bun run build` | Build all apps and packages |
| `bun run test` | Run tests across the monorepo |
| `bun run lint` | Lint all workspaces |
| `bun run clean` | Remove build artifacts |

## Data flow (quick reference)

```
User clicks "Buy YES $10"
   └─ Frontend (TradePanel)
         ├─ USDC.approve(CPMM, amount)
         ├─ CPMM.buyYes(amount)               ─── on-chain ──► Base
         └─ POST /markets/:id/record-trade
                │                                      │
                ▼                                      ▼
         API record-trade                      CPMM.buyYes
         - decode Trade event                  - 2% fee, x*y=k swap
         - insert trade row                    - mint YES tokens
         - update prices + positions           - emit Trade
                                                       │
                                                       ▼
                                              Indexer (watchContractEvent)
                                              - dedup + insert trade
                                              - refresh prices/positions
```

Every 60s, the resolution service polls DexScreener, compares to each market's threshold, and calls `MarketFactory.resolveMarket()` on-chain. The indexer picks up `MarketResolved`; users redeem via `MarketFactory.redeem()`.

## License

Private — all rights reserved.
