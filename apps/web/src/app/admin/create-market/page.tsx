"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, stringToHex } from "viem";
import { MarketFactoryABI, ERC20ABI, ResolutionSourceId } from "@nam-prediction/shared";
import { MARKET_FACTORY_ADDRESS, USDC_ADDRESS } from "@/lib/contracts";
import { UserCircle, Link2, TrendingUp } from "lucide-react";

type SourceOption = "admin" | "api" | "dexscreener";

export default function CreateMarketPage() {
  const { address, isConnected } = useAccount();
  const [question, setQuestion] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [liquidity, setLiquidity] = useState("");
  const [feeBps, setFeeBps] = useState("200");

  // Resolution source state
  const [resolutionSource, setResolutionSource] = useState<SourceOption>("admin");

  // DexScreener config
  const [dexComparison, setDexComparison] = useState(">=");
  const [dexThreshold, setDexThreshold] = useState("");

  const { writeContract: writeApprove, data: approveHash } = useWriteContract();
  const { writeContract: writeCreate, data: createHash } = useWriteContract();

  const { isLoading: isApproving } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: isCreating } = useWaitForTransactionReceipt({
    hash: createHash,
  });

  const isLoading = isApproving || isCreating;

  const buildResolutionData = (): `0x${string}` => {
    if (resolutionSource === "dexscreener") {
      const config = { comparison: dexComparison, threshold: Number(dexThreshold) };
      return stringToHex(JSON.stringify(config));
    }
    return "0x" as `0x${string}`;
  };

  const handleCreate = () => {
    if (!question || !endDate || !liquidity || !MARKET_FACTORY_ADDRESS) return;

    const endTimestamp = Math.floor(
      new Date(`${endDate}T${endTime || "23:59"}`).getTime() / 1000
    );
    const usdcAmount = parseUnits(liquidity, 6);
    const sourceId = ResolutionSourceId[resolutionSource];
    const resolutionData = buildResolutionData();

    // Step 1: Approve USDC
    writeApprove(
      {
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [MARKET_FACTORY_ADDRESS, usdcAmount],
      },
      {
        onSuccess: () => {
          // Step 2: Create market
          writeCreate({
            address: MARKET_FACTORY_ADDRESS,
            abi: MarketFactoryABI,
            functionName: "createMarket",
            args: [
              question,
              BigInt(endTimestamp),
              usdcAmount,
              BigInt(feeBps),
              sourceId,
              resolutionData,
            ],
          });
        },
      }
    );
  };

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6" style={{ color: "#e8e9ed" }}>Create Market</h1>

      <div className="glass-card p-6 space-y-5">
        {/* Question */}
        <div>
          <label className="block text-xs mb-1" style={{ color: "#717182" }}>
            Question
          </label>
          <input
            type="text"
            placeholder="Will BTC hit $100k by end of 2026?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none inner-border"
            style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
          />
        </div>

        {/* End date/time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "#717182" }}>
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none inner-border"
              style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "#717182" }}>
              End Time
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none inner-border"
              style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
            />
          </div>
        </div>

        {/* Initial liquidity */}
        <div>
          <label className="block text-xs mb-1" style={{ color: "#717182" }}>
            Initial Liquidity (USDC)
          </label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="1000"
            value={liquidity}
            onChange={(e) => setLiquidity(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none inner-border"
            style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
          />
          <p className="text-xs mt-1" style={{ color: "#717182" }}>
            This USDC seeds the 50/50 AMM liquidity pool
          </p>
        </div>

        {/* Fee */}
        <div>
          <label className="block text-xs mb-1" style={{ color: "#717182" }}>
            Trading Fee (basis points)
          </label>
          <input
            type="number"
            min="0"
            max="1000"
            step="50"
            placeholder="200"
            value={feeBps}
            onChange={(e) => setFeeBps(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none inner-border"
            style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
          />
          <p className="text-xs mt-1" style={{ color: "#717182" }}>
            200 = 2%. Fee goes to liquidity providers.
          </p>
        </div>

        {/* Resolution Source */}
        <div>
          <label className="block text-xs mb-2" style={{ color: "#717182" }}>
            Resolution Source
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { value: "admin", label: "Admin", Icon: UserCircle },
              { value: "api", label: "Backend API", Icon: Link2 },
              { value: "dexscreener", label: "NAM Price", Icon: TrendingUp },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setResolutionSource(opt.value)}
                className="py-2.5 px-3 rounded-lg text-sm font-medium transition text-left inner-border flex items-center gap-2"
                style={resolutionSource === opt.value
                  ? { background: "rgba(1,210,67,0.15)", color: "#01d243", borderColor: "rgba(1,210,67,0.25)" }
                  : { background: "rgba(31,32,40,0.50)", color: "#717182" }}
              >
                <opt.Icon className="w-4 h-4 flex-shrink-0" /> {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs mt-1" style={{ color: "#717182" }}>
            {resolutionSource === "admin" && "Resolved manually by admin."}
            {resolutionSource === "api" && "Auto-resolved via backend API."}
            {resolutionSource === "dexscreener" && "Auto-resolved based on NAM/USDC price from DexScreener."}
          </p>
        </div>

        {/* DexScreener config */}
        {resolutionSource === "dexscreener" && (
          <div className="space-y-3 glass-card-inner p-4">
            <h4 className="text-sm font-medium" style={{ color: "#e8e9ed" }}>NAM Price Config</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "#717182" }}>Condition</label>
                <select
                  value={dexComparison}
                  onChange={(e) => setDexComparison(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none inner-border"
                  style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
                >
                  <option value=">=">Price goes above or equal</option>
                  <option value="<=">Price goes below or equal</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "#717182" }}>Price Threshold ($)</label>
                <input
                  type="number"
                  step="0.001"
                  placeholder="0.05"
                  value={dexThreshold}
                  onChange={(e) => setDexThreshold(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none inner-border"
                  style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
                />
              </div>
            </div>
            <p className="text-xs" style={{ color: "#717182" }}>
              Resolved YES if NAM/USDC price meets threshold before end time, otherwise NO.
            </p>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleCreate}
          disabled={!isConnected || !question || !endDate || !liquidity || isLoading}
          className="w-full py-3 rounded-xl font-bold text-sm transition-all"
          style={isConnected && question && endDate && liquidity && !isLoading
            ? { background: "#01d243", color: "#000", cursor: "pointer" }
            : { background: "rgba(31,32,40,0.50)", color: "#717182", cursor: "not-allowed" }}
        >
          {!isConnected
            ? "Connect Wallet"
            : isLoading
            ? "Creating Market..."
            : "Create Market"}
        </button>

        {createHash && (
          <p className="text-xs text-center" style={{ color: "#717182" }}>
            Tx:{" "}
            <a
              href={`https://basescan.org/tx/${createHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#01d243" }}
              className="hover:underline"
            >
              {createHash.slice(0, 10)}...{createHash.slice(-8)}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
