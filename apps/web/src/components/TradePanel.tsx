"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { parseUnits, createPublicClient, createWalletClient, custom, http } from "viem";
import { base } from "viem/chains";
import { CPMMABI, ERC20ABI } from "@nam-prediction/shared";
import { USDC_ADDRESS } from "@/lib/contracts";
import { useAuth } from "@/hooks/useAuth";
import { useWallets } from "@privy-io/react-auth";
import { postApi } from "@/lib/api";

const QUICK = [1, 5, 10, 100];

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

interface TradePanelProps {
  marketId: number;
  ammAddress: `0x${string}`;
  yesPrice: number;
  noPrice: number;
}

export function TradePanel({ marketId, ammAddress, yesPrice, noPrice }: TradePanelProps) {
  const { address, isConnected } = useAccount();
  const { isAuthenticated, login } = useAuth();
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleTrade = async () => {
    if (!address || !amount || !wallets.length) return;
    setIsLoading(true);
    try {
      const wallet = wallets[0];
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      const usdcAmount = parseUnits(amount, 6);

      // Step 1: Approve USDC spend
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [ammAddress, usdcAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Step 2: Execute trade
      const fnName = side === "YES" ? "buyYes" : "buyNo";
      const tradeHash = await walletClient.writeContract({
        address: ammAddress,
        abi: CPMMABI,
        functionName: fnName,
        args: [usdcAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: tradeHash });

      // Step 3: Record trade in backend and refresh data
      try {
        await postApi(`/markets/${marketId}/record-trade`, { txHash: tradeHash });
      } catch (err) {
        console.error("Failed to record trade:", err);
      }
      queryClient.invalidateQueries({ queryKey: ["market", String(marketId)] });
      queryClient.invalidateQueries({ queryKey: ["market-trades", String(marketId)] });
      queryClient.invalidateQueries({ queryKey: ["markets"] });

      setAmount("");
    } catch (err) {
      console.error("Trade failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const num = parseFloat(amount) || 0;
  const price = side === "YES" ? yesPrice : noPrice;
  const shares = price > 0 ? num / price : 0;
  const win = shares;
  const profit = win - num;
  const pct = num > 0 ? (profit / num) * 100 : 0;
  const isYes = side === "YES";
  const C = isYes ? "#01d243" : "#ff4757";

  return (
    <div className="glass-card" style={{ overflow: "hidden" }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: "0.5px solid rgba(255,255,255,0.05)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "#e8e9ed" }}>Trade</h3>
      </div>

      <div className="px-5 pt-4 pb-5">
        {/* Yes / No toggle */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {(["YES", "NO"] as const).map(s => {
            const active = side === s;
            const sc = s === "YES" ? "#01d243" : "#ff4757";
            const price_c = s === "YES" ? Math.round(yesPrice * 100) : Math.round(noPrice * 100);
            return (
              <button key={s} onClick={() => setSide(s)} className="py-2.5 rounded-lg text-sm font-semibold transition-all inner-border"
                style={active
                  ? { background: `${sc}33`, color: sc, borderColor: `${sc}4d` }
                  : { background: "rgba(31,32,40,0.50)", color: "#717182" }}>
                {s === "YES" ? "Yes" : "No"} {price_c}¢
              </button>
            );
          })}
        </div>

        {/* Amount */}
        <p className="text-xs mb-2" style={{ color: "#717182" }}>Amount (USDC)</p>
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "#717182" }}>$</span>
          <input type="number" min="0" placeholder="0" value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full rounded-lg pl-7 pr-4 py-2.5 text-sm text-right outline-none inner-border"
            style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }} />
        </div>

        {/* Quick amounts */}
        <div className="flex gap-2 mb-5">
          {QUICK.map(q => (
            <button key={q} onClick={() => setAmount(s => String((parseFloat(s) || 0) + q))}
              className="flex-1 py-1.5 rounded-md text-xs transition-all inner-border"
              style={{ background: "rgba(31,32,40,0.50)", color: "#717182" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(31,32,40,0.80)"; e.currentTarget.style.color = "#e8e9ed"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(31,32,40,0.50)"; e.currentTarget.style.color = "#717182"; }}>
              +${q}
            </button>
          ))}
          <button onClick={() => setAmount("1000")}
            className="flex-1 py-1.5 rounded-md text-xs transition-all inner-border"
            style={{ background: "rgba(31,32,40,0.50)", color: "#717182" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(31,32,40,0.80)"; e.currentTarget.style.color = "#e8e9ed"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(31,32,40,0.50)"; e.currentTarget.style.color = "#717182"; }}>
            Max
          </button>
        </div>

        {/* Return breakdown */}
        <div className="rounded-xl p-4 mb-5 inner-border" style={{ background: "rgba(31,32,40,0.50)" }}>
          <div className="flex justify-between text-xs mb-2.5">
            <span style={{ color: "#717182" }}>Avg price</span>
            <span style={{ color: "#e8e9ed" }}>{(price * 100).toFixed(0)}¢</span>
          </div>
          <div className="flex justify-between text-xs mb-2.5">
            <span style={{ color: "#717182" }}>Shares</span>
            <span style={{ color: "#e8e9ed" }}>{num > 0 ? shares.toFixed(2) : "—"}</span>
          </div>
          <div className="my-2.5" style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />
          <div className="flex justify-between text-xs mb-2.5">
            <span style={{ color: "#717182" }}>Potential return</span>
            <span style={{ color: num > 0 ? C : "#717182", fontWeight: num > 0 ? 600 : 400 }}>
              {num > 0 ? `$${win.toFixed(2)} (+${pct.toFixed(1)}%)` : "—"}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: "#717182" }}>Max win</span>
            <span style={{ color: "rgba(232,233,237,0.80)" }}>{num > 0 ? `$${win.toFixed(2)}` : "—"}</span>
          </div>
        </div>

        {/* Trade button */}
        {!isAuthenticated ? (
          <button onClick={login}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
            style={{ background: "#01d243", color: "#000", cursor: "pointer" }}>
            Connect to Trade
          </button>
        ) : (
          <button onClick={handleTrade} disabled={!isConnected || num <= 0 || isLoading}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
            style={isConnected && num > 0 && !isLoading
              ? { background: C, color: isYes ? "#000" : "#fff", cursor: "pointer" }
              : { background: "rgba(31,32,40,0.50)", color: "#717182", cursor: "not-allowed" }}>
            {isLoading
              ? "Processing..."
              : num > 0
              ? `Buy ${side} · $${num.toFixed(2)}`
              : "Enter an amount"}
          </button>
        )}
        <p className="text-center text-[10px] mt-3" style={{ color: "rgba(113,113,130,0.50)" }}>By trading, you agree to the Terms of Use.</p>
      </div>
    </div>
  );
}
