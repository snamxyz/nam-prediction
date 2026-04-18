"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useM15History } from "@/hooks/useMarkets";

interface M15TimestampBarProps {
  currentMarketId: number;
}

export function M15TimestampBar({ currentMarketId }: M15TimestampBarProps) {
  const { data: history } = useM15History();
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
      <div
        className="flex items-center gap-2 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
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
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap"
              style={
                isActive
                  ? {
                      background: "rgba(1,210,67,0.20)",
                      color: "#01d243",
                      border: "1px solid rgba(1,210,67,0.40)",
                    }
                  : {
                      background: "rgba(31,32,40,0.60)",
                      color: isResolved ? "#717182" : "rgba(232,233,237,0.70)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }
              }
            >
              {label}
              {isResolved && !isActive && (
                <span className="ml-1 text-[10px]" style={{ color: m.result === 1 ? "#01d243" : "#ff4757" }}>
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
