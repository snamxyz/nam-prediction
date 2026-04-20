"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { parseUnits, createPublicClient, createWalletClient, custom, http } from "viem";
import { base } from "viem/chains";
import { VaultABI, ERC20ABI } from "@nam-prediction/shared";
import { VAULT_ADDRESS, USDC_ADDRESS } from "@/lib/contracts";
import { useAuth } from "@/hooks/useAuth";
import { useVaultBalance } from "@/hooks/useVaultBalance";
import { useWallets } from "@privy-io/react-auth";
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
  const { wallets } = useWallets();
  const { usdcBalance, refetch } = useVaultBalance();
  const [tab, setTab] = useState<"deposit" | "withdraw">(initialTab);
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasEscrow, setHasEscrow] = useState<boolean | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!address || !VAULT_ADDRESS) {
      setHasEscrow(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const escrow = (await publicClient.readContract({
          address: VAULT_ADDRESS,
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
  }, [address]);

  const handleDeposit = async () => {
    if (!address || !amount || !wallets.length) return;
    setIsLoading(true);
    const toastId = `deposit-${Date.now()}`;
    const amountLabel = amount;
    try {
      if (!VAULT_ADDRESS) throw new Error("Vault address is not configured.");

      const wallet = wallets[0];
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      const usdcAmount = parseUnits(amount, 6);

      toast.loading("Approve USDC spend in your wallet…", { id: toastId });
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [VAULT_ADDRESS, usdcAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      toast.loading("Approved. Sending deposit…", { id: toastId });
      const depositHash = await walletClient.writeContract({
        address: VAULT_ADDRESS,
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
    if (!address || !amount || !wallets.length) return;
    setIsLoading(true);
    const toastId = `withdraw-${Date.now()}`;
    const amountLabel = amount;
    try {
      if (!VAULT_ADDRESS) throw new Error("Vault address is not configured.");

      const wallet = wallets[0];
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      const usdcAmount = parseUnits(amount, 6);

      toast.loading("Confirm withdrawal in your wallet…", { id: toastId });
      const withdrawHash = await walletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VaultABI,
        functionName: "withdraw",
        args: [usdcAmount],
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
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: 360,
          maxWidth: "calc(100vw - 32px)",
          padding: 24,
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            background: "none",
            border: "none",
            color: "#4c4e68",
            fontSize: 18,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ×
        </button>

        {/* Balance */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.09em",
              color: "#4c4e68",
              marginBottom: 4,
            }}
          >
            Vault Balance
          </div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 500, color: "#01d243" }}>
            ${parseFloat(usdcBalance).toFixed(2)}
          </div>
        </div>

        {/* Deposit / Withdraw tabs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 18 }}>
          {(["deposit", "withdraw"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "9px 0",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${active ? "rgba(1,210,67,0.30)" : "rgba(255,255,255,0.04)"}`,
                  background: active ? "rgba(1,210,67,0.12)" : "#111320",
                  color: active ? "#01d243" : "#4c4e68",
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
              >
                {t === "deposit" ? "Deposit" : "Withdraw"}
              </button>
            );
          })}
        </div>

        {/* Amount input */}
        <div style={{ fontSize: 11, color: "#4c4e68", marginBottom: 6 }}>
          {tab === "deposit" ? "Deposit Amount (USDC)" : "Withdraw Amount (USDC)"}
        </div>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 13,
              color: "#4c4e68",
            }}
          >
            $
          </span>
          <input
            type="number"
            min="0"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mono"
            style={{
              width: "100%",
              borderRadius: 8,
              paddingLeft: 28,
              paddingRight: 14,
              paddingTop: 10,
              paddingBottom: 10,
              fontSize: 13,
              textAlign: "right",
              outline: "none",
              background: "#111320",
              color: "#e4e5eb",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          />
        </div>

        {tab === "withdraw" && (
          <button
            onClick={() => setAmount(usdcBalance)}
            style={{
              fontSize: 11,
              marginBottom: 10,
              padding: "4px 10px",
              borderRadius: 6,
              color: "#01d243",
              background: "rgba(1,210,67,0.08)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Max: ${parseFloat(usdcBalance).toFixed(2)}
          </button>
        )}

        {/* First-deposit notice */}
        {tab === "deposit" && isAuthenticated && hasEscrow === false && (
          <p
            style={{
              fontSize: 11,
              marginBottom: 10,
              padding: "8px 12px",
              borderRadius: 8,
              color: "#4c4e68",
              background: "rgba(1,210,67,0.05)",
              border: "1px solid rgba(1,210,67,0.12)",
            }}
          >
            Your first deposit will create your personal vault. A small one-time gas cost applies.
          </p>
        )}

        {/* Action button */}
        {!isAuthenticated ? (
          <button
            onClick={login}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              background: "#01d243",
              color: "#000",
              cursor: "pointer",
              border: "none",
            }}
          >
            Connect Wallet
          </button>
        ) : (
          <button
            onClick={tab === "deposit" ? handleDeposit : handleWithdraw}
            disabled={!isConnected || num <= 0 || isLoading}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              border: "none",
              transition: "all 0.12s",
              ...(isConnected && num > 0 && !isLoading
                ? { background: "#01d243", color: "#000", cursor: "pointer" }
                : { background: "#111320", color: "#4c4e68", cursor: "not-allowed" }),
            }}
          >
            {isLoading
              ? "Processing…"
              : num > 0
              ? `${tab === "deposit" ? "Deposit" : "Withdraw"} $${num.toFixed(2)}`
              : "Enter an amount"}
          </button>
        )}
      </div>
    </div>
  );
}
