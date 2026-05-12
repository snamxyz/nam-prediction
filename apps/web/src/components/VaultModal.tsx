"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { parseUnits, createPublicClient, createWalletClient, custom, formatUnits, http } from "viem";
import { base } from "viem/chains";
import { VaultABI, ERC20ABI } from "@nam-prediction/shared";
import { USDC_ADDRESS } from "@/lib/contracts";
import { floorBalance } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useContractConfig } from "@/hooks/useContractConfig";
import { useVaultBalance } from "@/hooks/useVaultBalance";
import { usePreferredWallet } from "@/hooks/usePreferredWallet";
import { toast } from "sonner";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface VaultModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: "deposit" | "withdraw";
}

export function VaultModal({ open, onClose, initialTab = "deposit" }: VaultModalProps) {
  const { address, isConnected } = useAccount();
  const { isAuthenticated, login } = useAuth();
  const preferredWallet = usePreferredWallet();
  const { usdcBalance, refetch } = useVaultBalance();
  const { vaultAddress } = useContractConfig();
  const [tab, setTab] = useState<"deposit" | "withdraw">(initialTab);
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasEscrow, setHasEscrow] = useState<boolean | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

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
    if (!preferredWallet || !amount) return;
    setIsLoading(true);
    const toastId = `deposit-${Date.now()}`;
    const amountLabel = amount;
    try {
      if (!vaultAddress) throw new Error("Vault address is not configured on the API.");

      const wallet = preferredWallet;
      const signerAddress = wallet.address as `0x${string}`;
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: signerAddress,
        chain: base,
        transport: custom(provider),
      });

      const usdcAmount = parseUnits(amount, 6);

      toast.loading("Approve USDC spend in your wallet…", { id: toastId });
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [vaultAddress, usdcAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      toast.loading("Approved. Sending deposit…", { id: toastId });
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
      onClose();
    } catch (err: any) {
      console.error("Deposit failed:", err);
      toast.error(err.shortMessage || err.message || "Deposit failed", { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!preferredWallet || !amount) return;
    setIsLoading(true);
    const toastId = `withdraw-${Date.now()}`;
    const amountLabel = amount;
    try {
      if (!vaultAddress) throw new Error("Vault address is not configured on the API.");

      const wallet = preferredWallet;
      const signerAddress = wallet.address as `0x${string}`;
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: signerAddress,
        chain: base,
        transport: custom(provider),
      });

      const usdcAmount = parseUnits(amount, 6);
      const onChainRaw = (await publicClient.readContract({
        address: vaultAddress,
        abi: VaultABI,
        functionName: "balanceOf",
        args: [signerAddress],
      })) as bigint;

      if (usdcAmount > onChainRaw) {
        toast.error(
          `Insufficient balance. Available: ${floorBalance(formatUnits(onChainRaw, 6))} USDC`,
          { id: toastId },
        );
        return;
      }

      const gasEstimate = await publicClient.estimateContractGas({
        address: vaultAddress,
        abi: VaultABI,
        functionName: "withdraw",
        args: [usdcAmount],
        account: signerAddress,
      });

      toast.loading("Confirm withdrawal in your wallet…", { id: toastId });
      const withdrawHash = await walletClient.writeContract({
        address: vaultAddress,
        abi: VaultABI,
        functionName: "withdraw",
        args: [usdcAmount],
        gas: (gasEstimate * BigInt(120)) / BigInt(100),
      });
      toast.loading("Processing withdrawal…", { id: toastId });
      await publicClient.waitForTransactionReceipt({ hash: withdrawHash });

      toast.success(`Withdrew $${amountLabel} USDC`, { id: toastId });
      setAmount("");
      refetch();
      onClose();
    } catch (err: any) {
      console.error("Withdraw failed:", err);
      toast.error(err.shortMessage || err.message || "Withdraw failed", { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  const num = parseFloat(amount) || 0;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-md max-h-screen top-0 left-0 w-screen h-screen"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card relative w-[360px] max-w-[calc(100vw-32px)] p-6">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3.5 top-3.5 cursor-pointer border-0 bg-transparent text-lg leading-none text-[var(--muted)]"
        >
          ×
        </button>

        {/* Balance */}
        <div className="mb-5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">
            Vault Balance
          </div>
          <div className="mono text-[28px] font-medium text-yes">
            ${floorBalance(usdcBalance)}
          </div>
        </div>

        {/* Deposit / Withdraw tabs */}
        <div className="mb-[18px] grid grid-cols-2 gap-1.5">
          {(["deposit", "withdraw"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`cursor-pointer rounded-lg border py-[9px] text-xs font-semibold transition-all duration-150 ${
                  active
                    ? "border-yes/30 bg-yes/[0.12] text-yes"
                    : "border-white/[0.04] bg-[var(--surface-hover)] text-[var(--muted)]"
                }`}
              >
                {t === "deposit" ? "Deposit" : "Withdraw"}
              </button>
            );
          })}
        </div>

        {/* Amount input */}
        <div className="mb-1.5 text-[11px] text-[var(--muted)]">
          {tab === "deposit" ? "Deposit Amount (USDC)" : "Withdraw Amount (USDC)"}
        </div>
        <div className="relative mb-2.5">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--muted)]">
            $
          </span>
          <input
            type="number"
            min="0"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mono w-full rounded-lg border border-white/[0.04] bg-[var(--surface-hover)] px-3.5 py-2.5 pl-7 text-right text-[13px] text-[var(--foreground)] outline-none"
          />
        </div>

        {tab === "withdraw" && (
          <button
            onClick={async () => {
              if (!address || !vaultAddress) return;
              try {
                const raw = (await publicClient.readContract({
                  address: vaultAddress,
                  abi: VaultABI,
                  functionName: "balanceOf",
                  args: [address],
                })) as bigint;
                setAmount(formatUnits(raw, 6));
              } catch (err: any) {
                console.error("Failed to fetch live vault balance:", err);
                toast.error(err.shortMessage || err.message || "Failed to fetch vault balance");
              }
            }}
            className="mb-2.5 cursor-pointer rounded-md border-0 bg-yes/[0.08] px-2.5 py-1 text-[11px] text-yes"
          >
            Max: ${floorBalance(usdcBalance)}
          </button>
        )}

        {/* First-deposit notice */}
        {tab === "deposit" && isAuthenticated && hasEscrow === false && (
          <p className="mb-2.5 rounded-lg border border-yes/[0.12] bg-yes/[0.05] px-3 py-2 text-[11px] text-[var(--muted)]">
            Your first deposit will create your personal vault. A small one-time gas cost applies.
          </p>
        )}

        {/* Action button */}
        {!isAuthenticated ? (
          <button
            onClick={login}
            className="w-full cursor-pointer rounded-[10px] border-0 bg-yes py-3 text-[13px] font-bold text-black"
          >
            Connect Wallet
          </button>
        ) : (
          <button
            onClick={tab === "deposit" ? handleDeposit : handleWithdraw}
            disabled={!isConnected || num <= 0 || isLoading}
            className={`w-full rounded-[10px] border-0 py-3 text-[13px] font-bold transition-all duration-150 ${
              isConnected && num > 0 && !isLoading
                ? "cursor-pointer bg-yes text-black"
                : "cursor-not-allowed bg-[var(--surface-hover)] text-[var(--muted)]"
            }`}
          >
            {isLoading
              ? "Processing…"
              : num > 0
              ? `${tab === "deposit" ? "Deposit" : "Withdraw"} $${floorBalance(amount)}`
              : "Enter an amount"}
          </button>
        )}
      </div>
    </div>
  );
}
