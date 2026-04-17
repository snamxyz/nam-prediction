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
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasEscrow, setHasEscrow] = useState<boolean | null>(null);

  // Check whether this wallet already has a per-user escrow deployed.
  // The very first deposit deploys a minimal-proxy clone, which costs a little extra gas.
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
    setError(null);
    setSuccess(null);
    try {
      if (!VAULT_ADDRESS) {
        throw new Error(
          "Vault address is not configured. Set NEXT_PUBLIC_VAULT_ADDRESS in your environment."
        );
      }

      const wallet = wallets[0];
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      const usdcAmount = parseUnits(amount, 6);

      // Step 1: Approve USDC spend to Vault
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20ABI,
        functionName: "approve",
        args: [VAULT_ADDRESS, usdcAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Step 2: Deposit into Vault
      const depositHash = await walletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VaultABI,
        functionName: "deposit",
        args: [usdcAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: depositHash });

      setSuccess(`Deposited $${amount} USDC`);
      setAmount("");
      setHasEscrow(true);
      refetch();
    } catch (err: any) {
      console.error("Deposit failed:", err);
      setError(err.shortMessage || err.message || "Deposit failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!address || !amount || !wallets.length) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (!VAULT_ADDRESS) {
        throw new Error(
          "Vault address is not configured. Set NEXT_PUBLIC_VAULT_ADDRESS in your environment."
        );
      }

      const wallet = wallets[0];
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      const usdcAmount = parseUnits(amount, 6);

      const withdrawHash = await walletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VaultABI,
        functionName: "withdraw",
        args: [usdcAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: withdrawHash });

      setSuccess(`Withdrew $${amount} USDC`);
      setAmount("");
      refetch();
    } catch (err: any) {
      console.error("Withdraw failed:", err);
      setError(err.shortMessage || err.message || "Withdraw failed");
    } finally {
      setIsLoading(false);
    }
  };

  const num = parseFloat(amount) || 0;

  return (
    <div className="glass-card" style={{ overflow: "hidden" }}>
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: "0.5px solid rgba(255,255,255,0.05)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "#e8e9ed" }}>Vault Balance</h3>
        {isAuthenticated && (
          <p className="text-2xl font-bold mt-1" style={{ color: "#01d243" }}>
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
                onClick={() => { setTab(t); setError(null); setSuccess(null); }}
                className="py-2.5 rounded-lg text-sm font-semibold transition-all inner-border"
                style={
                  active
                    ? { background: "rgba(1,210,67,0.15)", color: "#01d243", borderColor: "rgba(1,210,67,0.30)" }
                    : { background: "rgba(31,32,40,0.50)", color: "#717182" }
                }
              >
                {t === "deposit" ? "Deposit" : "Withdraw"}
              </button>
            );
          })}
        </div>

        {/* Amount input */}
        <p className="text-xs mb-2" style={{ color: "#717182" }}>
          {tab === "deposit" ? "Deposit Amount (USDC)" : "Withdraw Amount (USDC)"}
        </p>
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "#717182" }}>$</span>
          <input
            type="number"
            min="0"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg pl-7 pr-4 py-2.5 text-sm text-right outline-none inner-border"
            style={{ background: "rgba(31,32,40,0.60)", color: "#e8e9ed" }}
          />
        </div>

        {tab === "withdraw" && (
          <button
            onClick={() => setAmount(usdcBalance)}
            className="text-xs mb-3 px-2 py-1 rounded transition-all"
            style={{ color: "#01d243", background: "rgba(1,210,67,0.10)" }}
          >
            Max: ${parseFloat(usdcBalance).toFixed(2)}
          </button>
        )}

        {/* First-deposit notice: deploys the user's personal escrow clone */}
        {tab === "deposit" && isAuthenticated && hasEscrow === false && (
          <p
            className="text-xs mb-3 px-3 py-2 rounded-lg"
            style={{ color: "#9aa0b4", background: "rgba(1,210,67,0.06)", border: "0.5px solid rgba(1,210,67,0.15)" }}
          >
            Your first deposit will create your personal vault (your funds are isolated from other users). A small one-time gas cost applies.
          </p>
        )}

        {/* Error / Success */}
        {error && (
          <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ color: "#ff4757", background: "rgba(255,71,87,0.10)" }}>
            {error}
          </p>
        )}
        {success && (
          <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ color: "#01d243", background: "rgba(1,210,67,0.10)" }}>
            {success}
          </p>
        )}

        {/* Action button */}
        {!isAuthenticated ? (
          <button
            onClick={login}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
            style={{ background: "#01d243", color: "#000", cursor: "pointer" }}
          >
            Connect Wallet
          </button>
        ) : (
          <button
            onClick={tab === "deposit" ? handleDeposit : handleWithdraw}
            disabled={!isConnected || num <= 0 || isLoading}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
            style={
              isConnected && num > 0 && !isLoading
                ? { background: "#01d243", color: "#000", cursor: "pointer" }
                : { background: "rgba(31,32,40,0.50)", color: "#717182", cursor: "not-allowed" }
            }
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
