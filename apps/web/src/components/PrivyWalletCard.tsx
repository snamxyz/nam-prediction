"use client";

import { useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { useReadContract, useBalance } from "wagmi";
import { QRCodeSVG } from "qrcode.react";
import { Wallet, Copy, CheckCheck, QrCode, ChevronDown, ChevronUp } from "lucide-react";
import { ERC20ABI } from "@nam-prediction/shared";
import { USDC_ADDRESS } from "@/lib/contracts";
import { toast } from "sonner";

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function PrivyWalletCard() {
  const { wallets } = useWallets();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  // Find the Privy embedded wallet (not injected/external)
  const privyWallet = wallets.find(
    (w) => w.walletClientType === "privy"
  );
  const privyAddress = privyWallet?.address as `0x${string}` | undefined;

  // Off-vault USDC balance
  const { data: usdcRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20ABI,
    functionName: "balanceOf",
    args: privyAddress ? [privyAddress] : undefined,
    query: { enabled: !!privyAddress, staleTime: 30_000 },
  });
  const usdcBalance = usdcRaw ? (Number(usdcRaw) / 1e6).toFixed(2) : "0.00";

  // ETH balance
  const { data: ethData } = useBalance({
    address: privyAddress,
    query: { enabled: !!privyAddress, staleTime: 30_000 },
  });
  const ethBalance = ethData
    ? parseFloat(ethData.formatted).toFixed(6)
    : "0.000000";

  const handleCopy = async () => {
    if (!privyAddress) return;
    try {
      await navigator.clipboard.writeText(privyAddress);
      setCopied(true);
      toast.success("Address copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  if (!privyWallet || !privyAddress) return null;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-5">
        <Wallet className="w-5 h-5 text-yes" />
        <h2 className="text-base font-semibold text-[#e8e9ed]">
          Wallet Balance
        </h2>
      </div>

      {/* Address row */}
      <div className="mb-3 flex items-center justify-between rounded-lg bg-[#1f2028]/60 px-4 py-3">
        <div>
          <p className="mb-0.5 text-[11px] text-[#717182]">Your wallet address</p>
          <p className="font-mono text-xs text-[#e8e9ed]">{truncate(privyAddress)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className={`rounded p-1.5 transition-all ${
              copied ? "text-yes" : "text-[#717182]"
            }`}
            title="Copy address"
          >
            {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowQr(!showQr)}
            className={`rounded p-1.5 transition-all ${
              showQr ? "text-yes" : "text-[#717182]"
            }`}
            title="Show QR code"
          >
            <QrCode className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Balances */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-lg bg-[#1f2028]/60 px-4 py-3">
          <p className="mb-1 text-[11px] text-[#717182]">USDC (off-vault)</p>
          <p className="text-lg font-semibold text-[#e8e9ed]">${usdcBalance}</p>
        </div>
        <div className="rounded-lg bg-[#1f2028]/60 px-4 py-3">
          <p className="mb-1 text-[11px] text-[#717182]">ETH (for gas)</p>
          <p className="text-lg font-semibold text-[#e8e9ed]">{ethBalance}</p>
        </div>
      </div>

      {/* QR code (collapsible) */}
      {showQr && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-lg bg-[#1f2028]/60 py-4">
          <div className="p-3 rounded-lg bg-white">
            <QRCodeSVG
              value={privyAddress}
              size={160}
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
            />
          </div>
          <p className="px-4 text-center text-[11px] text-[#717182]">
            Scan to deposit. Send <strong className="text-[#e8e9ed]">USDC on Base</strong> only — other tokens or networks may be lost.
          </p>
          <button
            onClick={() => setShowQr(false)}
            className="flex items-center gap-1 text-xs text-[#717182]"
          >
            <ChevronUp className="w-3.5 h-3.5" /> Hide QR
          </button>
        </div>
      )}

      {!showQr && (
        <button
          onClick={() => setShowQr(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#1f2028]/50 py-2 text-xs text-[#717182] transition-all"
        >
          <QrCode className="w-3.5 h-3.5" />
          Show deposit QR code
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
