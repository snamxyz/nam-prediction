import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { MarketFactoryABI } from "@nam-prediction/shared";
import type { MarketRow } from "../../db/schema";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS as `0x${string}`;

/**
 * UMA resolver — monitors UMA-type markets and settles assertions after liveness.
 * The actual resolution happens via the on-chain callback (assertionResolvedCallback).
 * This helper just calls settleAssertion() to trigger it.
 */
export async function resolveUma(market: MarketRow): Promise<void> {
  if (!FACTORY_ADDRESS) {
    console.warn("[UMA] MARKET_FACTORY_ADDRESS not set");
    return;
  }

  const isPastEnd = new Date() >= new Date(market.endTime);
  if (!isPastEnd) return;

  try {
    const publicClient = createPublicClient({
      chain: base,
      transport: http(RPC_URL),
    });

    // Check if there's a pending assertion for this market
    const assertionId = await publicClient.readContract({
      address: FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      functionName: "marketToAssertion",
      args: [BigInt(market.onChainId)],
    }) as `0x${string}`;

    if (assertionId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      console.log(`[UMA] Market #${market.onChainId}: no assertion pending — awaiting on-chain proposal`);
      return;
    }

    // Try to settle the assertion (will revert if liveness not expired yet)
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.warn("[UMA] PRIVATE_KEY not set — cannot settle assertion");
      return;
    }

    const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(RPC_URL),
    });

    console.log(`[UMA] Market #${market.onChainId}: attempting to settle assertion ${assertionId}`);

    const txHash = await walletClient.writeContract({
      address: FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      functionName: "settleUmaAssertion",
      args: [BigInt(market.onChainId)],
    });

    console.log(`[UMA] Market #${market.onChainId}: settlement tx=${txHash}`);
  } catch (err: any) {
    // Liveness not expired yet or already settled — expected errors
    if (err.message?.includes("revert")) {
      console.log(`[UMA] Market #${market.onChainId}: assertion not yet settleable`);
    } else {
      console.error(`[UMA] Error for market #${market.onChainId}:`, err);
    }
  }
}
