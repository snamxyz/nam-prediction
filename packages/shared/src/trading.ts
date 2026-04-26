// EIP-712 typed-data schema for relayed trade intents.
//
// Users sign this off-chain; the backend verifies the signature,
// matches the recovered signer against the user's Privy-linked wallet,
// and then executes the trade via the Vault operator key.
//
// `amount` is denominated in USDC (6 decimals) for BUY intents and in
// outcome-token shares (18 decimals) for SELL intents.
// `minOutput` is the slippage floor, in the *opposite* unit:
//   - BUY:  minimum shares (18 decimals)
//   - SELL: minimum USDC   (6 decimals)

export const TRADING_DOMAIN_NAME = "Nam Prediction Trading";
export const TRADING_DOMAIN_VERSION = "1";

// Base mainnet chain id — exposed by addresses.ts, intentionally not re-exported here.
export const TRADING_DOMAIN = {
  name: TRADING_DOMAIN_NAME,
  version: TRADING_DOMAIN_VERSION,
  chainId: 8453,
} as const;

export const TRADE_INTENT_PRIMARY_TYPE = "TradeIntent" as const;

export const TRADE_INTENT_TYPES = {
  TradeIntent: [
    { name: "trader", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "ammAddress", type: "address" },
    { name: "isYes", type: "bool" },
    { name: "isBuy", type: "bool" },
    { name: "amount", type: "uint256" },
    { name: "minOutput", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface TradeIntent {
  trader: `0x${string}`;
  marketId: bigint;
  ammAddress: `0x${string}`;
  isYes: boolean;
  isBuy: boolean;
  amount: bigint;
  minOutput: bigint;
  nonce: bigint;
  deadline: bigint;
}

// ─── Range market trade intent ───
// `amount` is USDC (6 decimals) for BUY intents and shares (18 decimals) for SELL intents.
// `minOutput` is the slippage floor, in the opposite unit:
//   - BUY:  minimum shares (18 decimals)
//   - SELL: minimum USDC   (6 decimals)

export const RANGE_TRADE_INTENT_PRIMARY_TYPE = "RangeTradeIntent" as const;

export const RANGE_TRADE_INTENT_TYPES = {
  RangeTradeIntent: [
    { name: "trader", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "cpmmAddress", type: "address" },
    { name: "rangeIndex", type: "uint256" },
    { name: "isBuy", type: "bool" },
    { name: "amount", type: "uint256" },
    { name: "minOutput", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface RangeTradeIntent {
  trader: `0x${string}`;
  marketId: bigint;
  cpmmAddress: `0x${string}`;
  rangeIndex: bigint;
  isBuy: boolean;
  amount: bigint;
  minOutput: bigint;
  nonce: bigint;
  deadline: bigint;
}
