"use client";

import { useState } from "react";
import { useAdminOverview } from "@/hooks/useAdmin";
import { useContractConfig } from "@/hooks/useContractConfig";
import { useVaultChainTvl } from "@/hooks/useVaultChainTvl";
import { VaultABI } from "@nam-prediction/shared";
import { useWallets } from "@privy-io/react-auth";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { base } from "viem/chains";
import { AlertTriangle, DollarSign, Users, Activity, BarChart3, TrendingUp, ArrowDownLeft, ArrowUpRight, Layers } from "lucide-react";
import { toast } from "sonner";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

const EMERGENCY_REFUND_BATCH_SIZE = BigInt(50);

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-3">{icon}<span className="text-xs" style={{ color: "var(--muted)" }}>{label}</span></div>
      <div className="text-2xl font-semibold mb-1" style={{ color: "var(--foreground)" }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

function fmt(n: string | number) {
  const v = parseFloat(String(n));
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

export default function AdminDashboardPage() {
  const { data, isLoading } = useAdminOverview();
  const { vaultAddress } = useContractConfig();
  const { wallets } = useWallets();
  const [isRefunding, setIsRefunding] = useState(false);
  const {
    data: chainTvl,
    isPending: chainTvlPending,
    isError: chainTvlError,
    refetch: refetchChainTvl,
  } = useVaultChainTvl();

  const handleEmergencyRefund = async () => {
    if (isRefunding) return;
    const confirmed = window.confirm(
      "Emergency refund will enable emergency mode, block deposits/trades, and refund every current vault escrow in batches. Continue?",
    );
    if (!confirmed) return;

    setIsRefunding(true);
    const toastId = `emergency-refund-${Date.now()}`;
    try {
      if (!vaultAddress) throw new Error("Vault address is not configured.");
      if (!wallets.length) throw new Error("Connect the admin wallet first.");

      const wallet = wallets[0];
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const account = wallet.address as `0x${string}`;
      const walletClient = createWalletClient({
        account,
        chain: base,
        transport: custom(provider),
      });

      toast.loading("Checking vault refund state…", { id: toastId });
      const [emergencyMode, depositorCount] = await Promise.all([
        publicClient.readContract({
          address: vaultAddress,
          abi: VaultABI,
          functionName: "emergencyRefundMode",
        }),
        publicClient.readContract({
          address: vaultAddress,
          abi: VaultABI,
          functionName: "depositorCount",
        }),
      ]);

      if (!emergencyMode) {
        toast.loading("Enable emergency mode in your wallet…", { id: toastId });
        const modeHash = await walletClient.writeContract({
          address: vaultAddress,
          abi: VaultABI,
          functionName: "setEmergencyRefundMode",
          args: [true],
        });
        toast.loading("Enabling emergency mode…", { id: toastId });
        await publicClient.waitForTransactionReceipt({ hash: modeHash });
      }

      if (depositorCount === BigInt(0)) {
        toast.success("Emergency mode enabled. No depositors to refund.", { id: toastId });
        await refetchChainTvl();
        return;
      }

      for (let start = BigInt(0); start < depositorCount; start += EMERGENCY_REFUND_BATCH_SIZE) {
        const remaining = depositorCount - start;
        const batchSize = remaining < EMERGENCY_REFUND_BATCH_SIZE ? remaining : EMERGENCY_REFUND_BATCH_SIZE;
        const batchNumber = start / EMERGENCY_REFUND_BATCH_SIZE + BigInt(1);
        const batchTotal = (depositorCount + EMERGENCY_REFUND_BATCH_SIZE - BigInt(1)) / EMERGENCY_REFUND_BATCH_SIZE;

        toast.loading(`Confirm refund batch ${batchNumber.toString()} of ${batchTotal.toString()}…`, { id: toastId });
        const refundHash = await walletClient.writeContract({
          address: vaultAddress,
          abi: VaultABI,
          functionName: "emergencyRefund",
          args: [start, batchSize],
        });
        toast.loading(`Processing refund batch ${batchNumber.toString()} of ${batchTotal.toString()}…`, { id: toastId });
        await publicClient.waitForTransactionReceipt({ hash: refundHash });
      }

      toast.success("Emergency refund complete.", { id: toastId });
      await refetchChainTvl();
    } catch (err: any) {
      console.error("Emergency refund failed:", err);
      toast.error(err.shortMessage || err.message || "Emergency refund failed", { id: toastId });
    } finally {
      setIsRefunding(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "#ff4757" }}>Not authorised or failed to load</p>
      </div>
    );
  }

  const tvlVaultValue =
    !vaultAddress ? "—" : chainTvlPending ? "…" : chainTvlError ? "—" : fmt(chainTvl ?? "0");
  const tvlVaultSub =
    !vaultAddress
      ? undefined
      : chainTvlError
        ? "Could not load on-chain TVL"
        : chainTvlPending
          ? "Loading on-chain TVL…"
          : "On-chain USDC in vault escrows";

  const stats = [
    { icon: <Users className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Users", value: String(data.totalUsers), sub: `+${data.users24h} today · +${data.users7d} this week` },
    { icon: <Activity className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Trades", value: String(data.totalTrades), sub: `+${data.trades24h} today` },
    { icon: <TrendingUp className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Volume", value: fmt(data.totalVolume), sub: `${fmt(data.volume24h)} today` },
    { icon: <DollarSign className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "TVL (Vault)", value: tvlVaultValue, sub: tvlVaultSub },
    { icon: <Layers className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Win Rate (avg)", value: "—" },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)" }}>Dashboard</h1>
        <button
          type="button"
          onClick={handleEmergencyRefund}
          disabled={isRefunding || !vaultAddress}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-all disabled:opacity-50"
          style={{
            color: "#fff",
            background: "#ff4757",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {isRefunding ? "Refunding…" : "Emergency Refund"}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>
    </div>
  );
}
