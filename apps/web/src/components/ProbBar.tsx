"use client";

interface ProbBarProps {
  yes: number;
  height?: number;
}

export function ProbBar({ yes, height = 3 }: ProbBarProps) {
  const barHeight = height === 5 ? 5 : height === 4 ? 4 : 3;
  const safeYes = Math.max(0, Math.min(100, yes));

  return (
    <svg
      className="block w-full overflow-hidden rounded-full bg-white/[0.05]"
      height={barHeight}
      viewBox="0 0 100 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect width={safeYes} height="1" fill="var(--yes)" />
      <rect x={safeYes + 1} width={Math.max(0, 99 - safeYes)} height="1" fill="var(--no)" opacity="0.55" />
    </svg>
  );
}
