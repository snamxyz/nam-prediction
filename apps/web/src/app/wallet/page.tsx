"use client";

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  isAddress,
  parseEther,
  parseUnits,
} from "viem";
import { base } from "viem/chains";
import { useQuery } from "@tanstack/react-query";
import { ERC20ABI } from "@nam-prediction/shared";
import { NAM_TOKEN_ADDRESS, USDC_ADDRESS } from "@/lib/contracts";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Copy, CheckCheck, QrCode, Send, Wallet } from "lucide-react";
import { toast } from "sonner";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

type SendAsset = "ETH" | "USDC" | "NAM";

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTokenAmount(value: string, max = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString(undefined, {
    maximumFractionDigits: max,
  });
}

export default function WalletPage() {
  const { address } = useAccount();
  const { login, isAuthenticated, walletAddress } = useAuth();
  const { wallets } = useWallets();
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"receive" | "send">("receive");
  const [asset, setAsset] = useState<SendAsset>("USDC");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);

  const { data: namMeta } = useQuery({
    queryKey: ["nam-token-meta"],
    queryFn: () => fetchApi<{ tokenAddress: string | null; priceUsd: string }>("/markets/nam-price"),
    staleTime: 30_000,
  });

  const namTokenAddress = useMemo(
    () => (NAM_TOKEN_ADDRESS || namMeta?.tokenAddress || "") as `0x${string}`,
    [namMeta?.tokenAddress]
  );
  const walletFallbackAddress = wallets[0]?.address;
  const activeAddress = (address || walletAddress || walletFallbackAddress) as `0x${string}` | undefined;

  const { data: ethData, refetch: refetchEth } = useBalance({
    address: activeAddress,
    query: { enabled: !!activeAddress, staleTime: 30_000 },
  });
  const { data: usdcRaw, refetch: refetchUsdc } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20ABI,
    functionName: "balanceOf",
    args: activeAddress ? [activeAddress] : undefined,
    query: { enabled: !!activeAddress, staleTime: 30_000 },
  });
  const { data: namRaw, refetch: refetchNam } = useReadContract({
    address: namTokenAddress,
    abi: ERC20ABI,
    functionName: "balanceOf",
    args: activeAddress && namTokenAddress ? [activeAddress] : undefined,
    query: { enabled: !!activeAddress && !!namTokenAddress, staleTime: 30_000 },
  });
  const { data: namDecimalsRaw } = useReadContract({
    address: namTokenAddress,
    abi: ERC20ABI,
    functionName: "decimals",
    query: { enabled: !!namTokenAddress, staleTime: 60_000 },
  });

  const ethBalance = ethData?.formatted ?? "0";
  const usdcBalance = usdcRaw ? formatUnits(usdcRaw as bigint, 6) : "0";
  const namDecimals = Number(namDecimalsRaw ?? 18);
  const namBalance = namRaw ? formatUnits(namRaw as bigint, namDecimals) : "0";

  const copyAddress = async () => {
    if (!activeAddress) return;
    try {
      await navigator.clipboard.writeText(activeAddress);
      setCopied(true);
      toast.success("Wallet address copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Failed to copy address");
    }
  };

  const refreshBalances = () => {
    refetchEth();
    refetchUsdc();
    refetchNam();
  };

  const sendAsset = async () => {
    if (!activeAddress || !wallets.length || !amount) return;
    if (!isAddress(recipient)) {
      toast.error("Enter a valid recipient address");
      return;
    }

    setSending(true);
    const toastId = `wallet-send-${Date.now()}`;
    try {
      const wallet = wallets[0];
      await wallet.switchChain(base.id);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: activeAddress,
        chain: base,
        transport: custom(provider),
      });

      toast.loading("Confirm send in your wallet...", { id: toastId });
      let hash: `0x${string}`;
      if (asset === "ETH") {
        hash = await walletClient.sendTransaction({
          to: recipient as `0x${string}`,
          value: parseEther(amount),
        });
      } else {
        const tokenAddress = asset === "USDC" ? USDC_ADDRESS : namTokenAddress;
        if (!tokenAddress) throw new Error(`${asset} token address is not configured`);
        const decimals = asset === "USDC" ? 6 : namDecimals;
        hash = await walletClient.writeContract({
          address: tokenAddress,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [recipient as `0x${string}`, parseUnits(amount, decimals)],
        });
      }

      toast.loading("Waiting for confirmation...", { id: toastId });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`Sent ${amount} ${asset}`, { id: toastId });
      setAmount("");
      setRecipient("");
      refreshBalances();
    } catch (err: any) {
      toast.error(err?.shortMessage || err?.message || "Send failed", { id: toastId });
    } finally {
      setSending(false);
    }
  };

  if (!isAuthenticated || !activeAddress) {
    return (
      <div className="card fade-up" style={{ textAlign: "center", padding: "80px 20px" }}>
        <Wallet className="w-8 h-8" style={{ color: "var(--yes)", margin: "0 auto 16px" }} />
        <p style={{ fontSize: 18, fontWeight: 600, color: "var(--foreground)", marginBottom: 8 }}>Wallet</p>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>Connect your wallet to send and receive funds.</p>
        <button
          onClick={login}
          style={{ padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 700, background: "var(--yes)", color: "#000", border: "none", cursor: "pointer" }}
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ maxWidth: 880, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.025em", color: "var(--foreground)", marginBottom: 5 }}>
          Wallet
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Send and receive assets from your Base wallet.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          ["USDC", `$${formatTokenAmount(usdcBalance, 2)}`, "Base wallet"],
          ["ETH", formatTokenAmount(ethBalance, 6), "Gas balance"],
          ["NAM", namTokenAddress ? formatTokenAmount(namBalance, 4) : "Not configured", "Token balance"],
        ].map(([label, value, subtitle]) => (
          <div key={label} className="card" style={{ padding: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)", marginBottom: 5 }}>
              {label}
            </div>
            <div className="mono" style={{ fontSize: 21, color: "var(--foreground)" }}>{value}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{subtitle}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 6 }}>
              Wallet Address
            </div>
            <div className="mono" style={{ fontSize: 14, color: "var(--foreground)", wordBreak: "break-all" }}>{activeAddress}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{truncateAddress(activeAddress)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <div style={{ padding: 8, borderRadius: 10, background: "#fff", lineHeight: 0 }}>
              <QRCodeSVG value={activeAddress} size={92} bgColor="#ffffff" fgColor="#000000" level="M" />
            </div>
            <button
              onClick={copyAddress}
              style={{ padding: "9px 13px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-hover)", color: copied ? "var(--yes)" : "var(--foreground)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 18 }}>
          {(["receive", "send"] as const).map((value) => {
            const active = tab === value;
            return (
              <button
                key={value}
                onClick={() => setTab(value)}
                style={{ padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, border: active ? "1px solid color-mix(in srgb, var(--yes) 30%, transparent)" : "1px solid var(--border-subtle)", background: active ? "color-mix(in srgb, var(--yes) 12%, transparent)" : "var(--surface-hover)", color: active ? "var(--yes)" : "var(--muted)", cursor: "pointer" }}
              >
                {value === "receive" ? "Receive" : "Send"}
              </button>
            );
          })}
        </div>

        {tab === "receive" ? (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 22, alignItems: "center" }}>
            <div style={{ padding: 16, borderRadius: 12, background: "#fff", width: "fit-content" }}>
              <QRCodeSVG value={activeAddress} size={188} bgColor="#ffffff" fgColor="#000000" level="M" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--yes)", fontWeight: 700, marginBottom: 10 }}>
                <QrCode className="w-4 h-4" /> Receive on Base
              </div>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 16 }}>
                Share this address or QR code to receive ETH, USDC, or NAM on Base. Sending assets from other networks may make them unavailable in this wallet.
              </p>
              <button
                onClick={copyAddress}
                style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: "var(--yes)", color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Copy className="w-3.5 h-3.5" /> Copy Address
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 10 }}>
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value as SendAsset)}
                className="mono"
                style={{ borderRadius: 8, padding: "10px 12px", background: "var(--surface-hover)", color: "var(--foreground)", border: "1px solid var(--border-subtle)", outline: "none" }}
              >
                <option value="USDC">USDC</option>
                <option value="ETH">ETH</option>
                <option value="NAM" disabled={!namTokenAddress}>NAM</option>
              </select>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min="0"
                placeholder="Amount"
                className="mono"
                style={{ borderRadius: 8, padding: "10px 12px", textAlign: "right", background: "var(--surface-hover)", color: "var(--foreground)", border: "1px solid var(--border-subtle)", outline: "none" }}
              />
            </div>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Recipient address"
              className="mono"
              style={{ borderRadius: 8, padding: "10px 12px", background: "var(--surface-hover)", color: "var(--foreground)", border: "1px solid var(--border-subtle)", outline: "none" }}
            />
            <button
              onClick={sendAsset}
              disabled={sending || !amount || !recipient || (asset === "NAM" && !namTokenAddress)}
              style={{ padding: "12px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, border: "none", background: !sending && amount && recipient ? "var(--yes)" : "var(--surface-hover)", color: !sending && amount && recipient ? "#000" : "var(--muted)", cursor: !sending && amount && recipient ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}
            >
              <Send className="w-4 h-4" />
              {sending ? "Sending..." : `Send ${asset}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
