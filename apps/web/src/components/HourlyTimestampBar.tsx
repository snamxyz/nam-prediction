"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useHourlyHistory } from "@/hooks/useMarkets";

interface HourlyTimestampBarProps {
  currentMarketId: number;
}

export function HourlyTimestampBar({ currentMarketId }: HourlyTimestampBarProps) {
  const { data: history } = useHourlyHistory();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Auto-scroll active pill into view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [currentMarketId, history]);

  if (!history || history.length <= 1) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {/* Render oldest first (reverse since API returns desc) */}
        {[...history].reverse().map((m) => {
          const isActive = m.id === currentMarketId;
          const endTime = new Date(m.endTime);
          const label = endTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const isResolved = m.resolved;

          return (
            <Link
              key={m.id}
              ref={isActive ? activeRef : undefined}
              href={`/market/${m.id}`}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? "border-yes/40 bg-yes/20 text-yes"
                  : isResolved
                    ? "border-white/[0.06] bg-[#1f2028]/60 text-[#717182]"
                    : "border-white/[0.06] bg-[#1f2028]/60 text-[#e8e9ed]/70"
              }`}
            >
              {label}
              {isResolved && !isActive && (
                <span className={`ml-1 text-[10px] ${m.result === 1 ? "text-yes" : "text-[#ff4757]"}`}>
                  {m.result === 1 ? "Y" : "N"}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
