"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { parseUnits, createPublicClient, createWalletClient, custom, http } from "viem";
import { base } from "viem/chains";
import { VaultABI, ERC20ABI } from "@nam-prediction/shared";
import { USDC_ADDRESS } from "@/lib/contracts";
import { useAuth } from "@/hooks/useAuth";
import { useContractConfig } from "@/hooks/useContractConfig";
import { useVaultBalance } from "@/hooks/useVaultBalance";
import { useWallets } from "@privy-io/react-auth";
import { toast } from "sonner";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function DepositWithdrawPanel() {
  const { address, isConnected } = useAccount();
  const { isAuthenticated, login } = useAuth();
  const { wallets } = useWallets();
  const { usdcBalance, refetch } = useVaultBalance();
  const { vaultAddress } = useContractConfig();
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasEscrow, setHasEscrow] = useState<boolean | null>(null);

  // Check whether this wallet already has a per-user escrow deployed.
  // The very first deposit deploys a minimal-proxy clone, which costs a little extra gas.
  useEffect(() => {
    if (!address || !vaultAddress) {
      setHasEscrow(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const escrow = (await publicClient.readContract({
          address: vaultAddress,
          abi: VaultABI,
          functionName: "escrowOf",
          args: [address],
        })) as `0x${string}`;
        if (!cancelled) setHasEscrow(escrow.toLowerCase() !== ZERO_ADDRESS);
      } catch {
        if (!cancelled) setHasEscrow(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, vaultAddress]);

  const handleDeposit = async () => {
    if (!address || !amount || !wallets.length) return;
    setIsLoading(true);
    const toastId = `deposit-${Date.now()}`;
    const amountLabel = amount;
    try {
      if (!vaultAddress) {
        throw new Error("Vault address is not configured on the API.");
      }

      const wallet = wallets[0];
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      const usdcAmount = parseUnits(amount, 6);

      toast.loading("Approve USDC spend in your wallet\u2026", { id: toastId });
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [vaultAddress, usdcAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      toast.loading("Approved. Sending deposit\u2026", { id: toastId });
      const depositHash = await walletClient.writeContract({
        address: vaultAddress,
        abi: VaultABI,
        functionName: "deposit",
        args: [usdcAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: depositHash });

      toast.success(`Deposited $${amountLabel} USDC`, { id: toastId });
      setAmount("");
      setHasEscrow(true);
      refetch();
    } catch (err: any) {
      console.error("Deposit failed:", err);
      toast.error(err.shortMessage || err.message || "Deposit failed", {
        id: toastId,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!address || !amount || !wallets.length) return;
    setIsLoading(true);
    const toastId = `withdraw-${Date.now()}`;
    const amountLabel = amount;
    try {
      if (!vaultAddress) {
        throw new Error("Vault address is not configured on the API.");
      }

      const wallet = wallets[0];
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      const usdcAmount = parseUnits(amount, 6);

      toast.loading("Confirm withdrawal in your wallet\u2026", { id: toastId });
      const withdrawHash = await walletClient.writeContract({
        address: vaultAddress,
        abi: VaultABI,
        functionName: "withdraw",
        args: [usdcAmount],
      });
      toast.loading("Processing withdrawal\u2026", { id: toastId });
      await publicClient.waitForTransactionReceipt({ hash: withdrawHash });

      toast.success(`Withdrew $${amountLabel} USDC`, { id: toastId });
      setAmount("");
      refetch();
    } catch (err: any) {
      console.error("Withdraw failed:", err);
      toast.error(err.shortMessage || err.message || "Withdraw failed", {
        id: toastId,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const num = parseFloat(amount) || 0;

  return (
    <div className="glass-card fixed inset-0 z-[100] overflow-auto bg-black/55 backdrop-blur-md">
      <div className="border-b border-white/[0.05] px-5 pb-4 pt-5">
        <h3 className="text-sm font-semibold text-[#e8e9ed]">Vault Balance</h3>
        {isAuthenticated && (
          <p className="mt-1 text-2xl font-bold text-yes">
            ${parseFloat(usdcBalance).toFixed(2)}
          </p>
        )}
      </div>

      <div className="px-5 pt-4 pb-5">
        {/* Deposit / Withdraw tabs */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {(["deposit", "withdraw"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`inner-border rounded-lg py-2.5 text-sm font-semibold transition-all ${
                  active
                    ? "border-yes/30 bg-yes/15 text-yes"
                    : "bg-[#1f2028]/50 text-[#717182]"
                }`}
              >
                {t === "deposit" ? "Deposit" : "Withdraw"}
              </button>
            );
          })}
        </div>

        {/* Amount input */}
        <p className="mb-2 text-xs text-[#717182]">
          {tab === "deposit" ? "Deposit Amount (USDC)" : "Withdraw Amount (USDC)"}
        </p>
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#717182]">$</span>
          <input
            type="number"
            min="0"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="inner-border w-full rounded-lg bg-[#1f2028]/60 py-2.5 pl-7 pr-4 text-right text-sm text-[#e8e9ed] outline-none"
          />
        </div>

        {tab === "withdraw" && (
          <button
            onClick={() => setAmount(usdcBalance)}
            className="mb-3 rounded bg-yes/10 px-2 py-1 text-xs text-yes transition-all"
          >
            Max: ${parseFloat(usdcBalance).toFixed(2)}
          </button>
        )}

        {/* First-deposit notice: deploys the user's personal escrow clone */}
        {tab === "deposit" && isAuthenticated && hasEscrow === false && (
          <p
            className="mb-3 rounded-lg border border-yes/15 bg-yes/[0.06] px-3 py-2 text-xs text-[#9aa0b4]"
          >
            Your first deposit will create your personal vault (your funds are isolated from other users). A small one-time gas cost applies.
          </p>
        )}

        {/* Action button */}
        {!isAuthenticated ? (
          <button
            onClick={login}
            className="w-full cursor-pointer rounded-xl bg-yes py-3 text-sm font-semibold text-black transition-all"
          >
            Connect Wallet
          </button>
        ) : (
          <button
            onClick={tab === "deposit" ? handleDeposit : handleWithdraw}
            disabled={!isConnected || num <= 0 || isLoading}
            className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
              isConnected && num > 0 && !isLoading
                ? "cursor-pointer bg-yes text-black"
                : "cursor-not-allowed bg-[#1f2028]/50 text-[#717182]"
            }`}
          >
            {isLoading
              ? "Processing..."
              : num > 0
              ? `${tab === "deposit" ? "Deposit" : "Withdraw"} $${num.toFixed(2)}`
              : "Enter an amount"}
          </button>
        )}
      </div>
    </div>
  );
}
