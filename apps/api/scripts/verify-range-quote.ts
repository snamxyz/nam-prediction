import postgres from "postgres";
import { createPublicClient, formatUnits, http } from "viem";
import { base } from "viem/chains";
import { RangeLMSRABI } from "@nam-prediction/shared";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/nam_prediction";

const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  const rows = await sql.unsafe(
    "SELECT id, market_type, range_cpmm_address FROM range_markets WHERE status = 'active' ORDER BY id"
  );
  const activeRows = Array.from(rows);
  console.log("[verify-range-quote] Active markets:", activeRows);

  const receipts = activeRows.find((row) => row.market_type === "receipts");
  if (!receipts?.range_cpmm_address) {
    throw new Error("No active receipts range market found");
  }

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.RPC_URL || "https://mainnet.base.org"),
  });

  const quote = await client.readContract({
    address: receipts.range_cpmm_address as `0x${string}`,
    abi: RangeLMSRABI,
    functionName: "quoteBuy",
    args: [BigInt(2), BigInt(10_000)],
  }) as bigint;

  const prices = await client.readContract({
    address: receipts.range_cpmm_address as `0x${string}`,
    abi: RangeLMSRABI,
    functionName: "getPrices",
  }) as bigint[];

  console.log("[verify-range-quote] $0.01 quote for receipts range 2:", {
    quoteRaw: quote.toString(),
    quoteTokens: formatUnits(quote, 18),
    prices: prices.map((price) => formatUnits(price, 18)),
  });
}

main()
  .catch((err) => {
    console.error("[verify-range-quote] Error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
