"use client";

interface ProbBarProps {
  yes: number;
  height?: number;
}

export function ProbBar({ yes, height = 3 }: ProbBarProps) {
  return (
    <div
      style={{
        height,
        borderRadius: height,
        background: "rgba(255,255,255,0.05)",
        overflow: "hidden",
        display: "flex",
        gap: 1,
      }}
    >
      <div
        style={{
          width: `${yes}%`,
          height: "100%",
          background: "#01d243",
          borderRadius: height,
          transition: "width 0.7s cubic-bezier(0.4,0,0.2,1)",
        }}
      />
      <div
        style={{
          flex: 1,
          height: "100%",
          background: "#f0324c",
          opacity: 0.55,
          borderRadius: height,
        }}
      />
    </div>
  );
}
