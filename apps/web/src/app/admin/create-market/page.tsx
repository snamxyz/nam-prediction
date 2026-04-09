"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, toHex, stringToHex } from "viem";
import { MarketFactoryABI, ERC20ABI, ResolutionSourceId } from "@nam-prediction/shared";
import { MARKET_FACTORY_ADDRESS, USDC_ADDRESS } from "@/lib/contracts";
import type { ResolutionSourceType } from "@nam-prediction/shared";

type SourceOption = "admin" | "internal" | "dexscreener" | "uma";

export default function CreateMarketPage() {
  const { address, isConnected } = useAccount();
  const [question, setQuestion] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [liquidity, setLiquidity] = useState("");
  const [feeBps, setFeeBps] = useState("200");

  // Resolution source state
  const [resolutionSource, setResolutionSource] = useState<SourceOption>("admin");

  // Internal config
  const [metricName, setMetricName] = useState("");
  const [comparison, setComparison] = useState(">=");
  const [threshold, setThreshold] = useState("");

  // DexScreener config
  const [dexComparison, setDexComparison] = useState(">=");
  const [dexThreshold, setDexThreshold] = useState("");

  // UMA config
  const [umaClaim, setUmaClaim] = useState("");
  const [umaBond, setUmaBond] = useState("100");

  const { writeContract: writeApprove, data: approveHash } = useWriteContract();
  const { writeContract: writeCreate, data: createHash } = useWriteContract();

  const { isLoading: isApproving } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: isCreating } = useWaitForTransactionReceipt({
    hash: createHash,
  });

  const isLoading = isApproving || isCreating;

  const buildResolutionData = (): `0x${string}` => {
    let config: object | null = null;

    switch (resolutionSource) {
      case "internal":
        config = { metricName, comparison, threshold: Number(threshold) };
        break;
      case "dexscreener":
        config = { comparison: dexComparison, threshold: Number(dexThreshold) };
        break;
      case "uma":
        config = { claim: umaClaim, bond: Number(umaBond) };
        break;
      case "admin":
      default:
        return "0x" as `0x${string}`;
    }

    // Encode config as UTF-8 JSON bytes
    return stringToHex(JSON.stringify(config));
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
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "admin", label: "Admin", icon: "👤" },
              { value: "internal", label: "Internal Data", icon: "📊" },
              { value: "dexscreener", label: "NAM Price", icon: "📈" },
              { value: "uma", label: "UMA Oracle", icon: "⚖️" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setResolutionSource(opt.value)}
                className="py-2.5 px-3 rounded-lg text-sm font-medium transition text-left inner-border"
                style={resolutionSource === opt.value
                  ? { background: "rgba(1,210,67,0.15)", color: "#01d243", borderColor: "rgba(1,210,67,0.25)" }
                  : { background: "rgba(31,32,40,0.50)", color: "#717182" }}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs mt-1" style={{ color: "#717182" }}>
            {resolutionSource === "admin" && "Resolved manually by admin."}
            {resolutionSource === "internal" && "Auto-resolved when an internal app metric meets a threshold."}
            {resolutionSource === "dexscreener" && "Auto-resolved based on NAM/USDC price from DexScreener."}
            {resolutionSource === "uma" && "Trustless resolution via UMA Optimistic Oracle, anyone can propose."}
          </p>
        </div>

        {/* Internal config */}
        {resolutionSource === "internal" && (
          <div className="space-y-3 glass-card-inner p-4">
            <h4 className="text-sm font-medium" style={{ color: "#e8e9ed" }}>Internal Metric Config</h4>
            <div>
              <label className="block text-xs mb-1" style={{ color: "#717182" }}>Metric Name</label>
              <input
                type="text"
                placeholder="e.g. receipt_uploads_today"
                value={metricName}
                onChange={(e) => setMetricName(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none inner-border"
                style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "#717182" }}>Comparison</label>
                <select
                  value={comparison}
                  onChange={(e) => setComparison(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none inner-border"
                  style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
                >
                  <option value=">=">≥ (greater or equal)</option>
                  <option value=">">{">"} (greater than)</option>
                  <option value="<=">≤ (less or equal)</option>
                  <option value="==">= (equal)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "#717182" }}>Threshold</label>
                <input
                  type="number"
                  placeholder="100"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none inner-border"
                  style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
                />
              </div>
            </div>
          </div>
        )}

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

        {/* UMA config */}
        {resolutionSource === "uma" && (
          <div className="space-y-3 glass-card-inner p-4">
            <h4 className="text-sm font-medium" style={{ color: "#e8e9ed" }}>UMA Oracle Config</h4>
            <div>
              <label className="block text-xs mb-1" style={{ color: "#717182" }}>Claim Text</label>
              <textarea
                placeholder="The market question resolved as YES because..."
                value={umaClaim}
                onChange={(e) => setUmaClaim(e.target.value)}
                rows={2}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none inner-border resize-none"
                style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
              />
              <p className="text-xs mt-1" style={{ color: "#717182" }}>
                This text will be used as the UMA assertion claim.
              </p>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "#717182" }}>Bond Amount (USDC)</label>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="100"
                value={umaBond}
                onChange={(e) => setUmaBond(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none inner-border"
                style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
              />
              <p className="text-xs mt-1" style={{ color: "#717182" }}>
                Bond required to propose resolution. Returned if not disputed.
              </p>
            </div>
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
