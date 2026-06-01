"use client";

import { useState } from "react";
import { useAdminOverview } from "@/hooks/useAdmin";
import { useContractConfig } from "@/hooks/useContractConfig";
import { useVaultChainTvl } from "@/hooks/useVaultChainTvl";
import { VaultABI } from "@nam-prediction/shared";
import { usePreferredWallet } from "@/hooks/usePreferredWallet";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { base } from "viem/chains";
import { AlertTriangle, DollarSign, Users, Activity, TrendingUp, ArrowUpRight, Layers, Landmark } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/UI/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/UI/dialog";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

const EMERGENCY_REFUND_BATCH_SIZE = BigInt(50);

function StatCard({
  icon,
  label,
  value,
  sub,
  valueClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-3">{icon}<span className="text-xs" style={{ color: "var(--muted)" }}>{label}</span></div>
      <div className={`text-2xl font-semibold mb-1 ${valueClassName ?? ""}`} style={valueClassName ? undefined : { color: "var(--foreground)" }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

function fmt(n: string | number) {
  const v = parseFloat(String(n));
  if (!Number.isFinite(v)) return "$0.00";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtSigned(n: string | number) {
  const v = parseFloat(String(n));
  if (!Number.isFinite(v)) return "$0.00";
  const abs = fmt(Math.abs(v));
  if (v < 0) return `-${abs}`;
  return abs;
}

function snapshotLabel(snapshotAt?: string, source?: string) {
  if (!snapshotAt) return undefined;
  const time = new Date(snapshotAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `Last updated ${time}${source === "redis" ? "" : " from saved data"}`;
}

export default function AdminDashboardPage() {
  const { data, isLoading } = useAdminOverview();
  const { vaultAddress } = useContractConfig();
  const preferredWallet = usePreferredWallet();
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
      if (!preferredWallet) throw new Error("Connect the admin wallet first.");

      const wallet = preferredWallet;
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
        {[...Array(13)].map((_, i) => (
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
        ? "Could not load the live vault balance."
        : chainTvlPending
          ? "Loading the live vault balance..."
          : "Money currently held in the vault for markets.";
  const housePnl = parseFloat(data.housePnl ?? "0");
  const housePnlClassName =
    housePnl > 0 ? "text-yes" : housePnl < 0 ? "text-no" : "text-[var(--foreground)]";
  const currentLiquiditySource =
    data.currentLiquiditySource === "chain"
      ? "Live market balances available now."
      : data.currentLiquiditySource === "mixed"
        ? `${data.currentLiquidityFailedPools ?? 0} market balance${data.currentLiquidityFailedPools === 1 ? "" : "s"} used the last saved value.`
        : "Last saved market balance.";

  const stats = [
    { icon: <Users className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Users", value: String(data.totalUsers), sub: `People who have joined the app. +${data.users24h} today, +${data.users7d} this week.` },
    { icon: <Activity className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Trades", value: String(data.totalTrades), sub: `Completed trades across all markets. +${data.trades24h} today.` },
    { icon: <TrendingUp className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Trade Value", value: fmt(data.totalVolume), sub: `Total money users have traded. ${fmt(data.volume24h)} was traded in the last 24 hours.` },
    { icon: <DollarSign className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Vault Balance", value: tvlVaultValue, sub: tvlVaultSub ?? "Money currently held in the vault for markets." },
    { icon: <DollarSign className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Saved Vault Balance", value: fmt(data.tvl), sub: `Balance from saved activity: ${fmt(data.totalDeposits)} added, ${fmt(data.totalWithdrawals)} removed.` },
    { icon: <Landmark className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Money Added To Markets", value: fmt(data.startingLiquidity ?? 0), sub: "Total house money supplied when markets were created." },
    { icon: <Landmark className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Money Left At Close", value: fmt(data.endingLiquidity ?? 0), sub: "Money remaining in markets after they ended." },
    { icon: <Layers className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Current Market Money", value: fmt(data.currentLiquidity ?? 0), sub: `${currentLiquiditySource} ${fmt(data.totalRedemptions ?? 0)} has been paid out to winners.` },
    { icon: <TrendingUp className="w-4 h-4" style={{ color: housePnl >= 0 ? "var(--yes)" : "var(--no)" }} />, label: "House Profit/Loss", value: fmtSigned(data.housePnl ?? 0), sub: `How much the house is up or down after payouts. ${data.housePnlFinalCount ?? 0} markets are final, ${data.housePnlEstimatedCount ?? 0} still need final numbers.`, valueClassName: housePnlClassName },
    { icon: <DollarSign className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Total Fees", value: fmt(data.totalFees ?? 0), sub: "Fees collected by the platform from completed trades." },
    { icon: <Layers className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Money In Open Markets", value: fmt(data.activeLiquidity ?? 0), sub: "House money currently being used by markets that are still open." },
    { icon: <AlertTriangle className="w-4 h-4" style={{ color: "var(--no)" }} />, label: "Possible Payouts", value: fmt(data.liquidityAtRisk ?? 0), sub: `Money that may need to be paid to winners: ${fmt(data.reservedClaims ?? 0)} ready, ${fmt(data.outstandingWinningClaims ?? 0)} still pending.` },
    { icon: <ArrowUpRight className="w-4 h-4" style={{ color: "var(--yes)" }} />, label: "Money Withdrawn", value: fmt(data.liquidityWithdrawn ?? 0), sub: "House money removed from markets after they ended." },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)" }}>Dashboard</h1>
          {data.snapshotAt && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {snapshotLabel(data.snapshotAt, data.snapshotSource)}
              {data.stale ? " · rebuilt on demand" : ""}
            </p>
          )}
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <button
            type="button"
            onClick={handleEmergencyRefund}
            disabled={isRefunding || !vaultAddress}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-all disabled:opacity-50"
            style={{
              color: "#fff",
              background: "#ff4757",
            
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {isRefunding ? "Refunding…" : "Emergency Refund"}
          </button>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              What does this do?
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg backdrop-blur-md">
              <DialogHeader>
                <DialogTitle>Emergency Refund</DialogTitle>
                <DialogDescription>
                  Turns on vault emergency mode, blocks normal vault activity, then refunds current vault escrows
                  in batches of 50 depositors. Each batch needs a wallet confirmation.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm leading-6 text-[var(--muted)]">
                <p><span className="font-medium text-[var(--foreground)]">Active market:</span> vault funds are refunded; market positions are not resolved.</p>
                <p><span className="font-medium text-[var(--foreground)]">Closed market:</span> vault escrows refund; winner redemption remains separate.</p>
                <p><span className="font-medium text-[var(--foreground)]">No vault funds:</span> emergency mode enables, then no refund batches run.</p>
                <p><span className="font-medium text-[var(--foreground)]">Mid-way failure:</span> completed batches stay refunded; retry the remaining batches.</p>
              </div>
              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>
    </div>
  );
}
