import { parseNamPriceParts } from "@/lib/format";

interface NamPriceDisplayProps {
  price: number | null;
  className?: string;
}

/**
 * Renders a NAM price using subscript zero notation for very small prices.
 * e.g. 0.000004607 renders as: $0.0<sub>5</sub>4607
 */
export function NamPriceDisplay({ price, className }: NamPriceDisplayProps) {
  const parts = parseNamPriceParts(price);

  if (!parts.useSubscript) {
    return <span className={className}>{parts.plain}</span>;
  }

  return (
    <span className={className}>
      $0.0<sub className="text-[0.65em]">{parts.zeroCount}</sub>
      {parts.sigDigits}
    </span>
  );
}
