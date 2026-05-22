"use client";

interface ProbBarProps {
  yes: number;
  height?: number;
}

export function ProbBar({ yes, height = 3 }: ProbBarProps) {
  const safeYes = Math.max(0, Math.min(100, yes));
  const safeNo = 100 - safeYes;

  return (
    <div
      className="relative w-full overflow-hidden rounded-full bg-white/[0.05]"
      style={{ height }}
      aria-hidden="true"
    >
      <div
        className="absolute left-0 top-0 h-full rounded-full bg-yes"
        style={{
          width: `${safeYes}%`,
          transition: "width 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
      <div
        className="absolute top-0 h-full bg-no/55"
        style={{
          left: `${safeYes}%`,
          width: `${safeNo}%`,
          transition:
            "left 0.7s cubic-bezier(0.4, 0, 0.2, 1), width 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    </div>
  );
}
