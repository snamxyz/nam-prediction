const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT_DIGITS[parseInt(d)])
    .join("");
}

/**
 * Parses a NAM price into parts for subscript zero notation.
 * e.g. 0.000004607 → { prefix: "$0.0", zeroCount: 5, sigDigits: "4607", useSubscript: true }
 * When zeroCount < 4, returns { plain: "$0.00042", useSubscript: false }
 */
export function parseNamPriceParts(
  price: number | null
):
  | { useSubscript: true; zeroCount: number; sigDigits: string }
  | { useSubscript: false; plain: string } {
  if (price === null) return { useSubscript: false, plain: "$—" };

  const str = price.toFixed(20);
  const decimal = str.split(".")[1] ?? "";

  let zeroCount = 0;
  for (const char of decimal) {
    if (char === "0") zeroCount++;
    else break;
  }

  if (zeroCount < 4) {
    return { useSubscript: false, plain: `$${price.toFixed(Math.max(zeroCount + 2, 5))}` };
  }

  const sigDigits = decimal.slice(zeroCount, zeroCount + 4);
  return { useSubscript: true, zeroCount, sigDigits };
}

/**
 * Returns a plain string representation using Unicode subscript digits.
 * Suitable for chart formatters and other string-only contexts.
 * e.g. 0.000004607 → "$0.0₅4607"
 */
export function formatNamPriceString(price: number | null): string {
  const parts = parseNamPriceParts(price);
  if (!parts.useSubscript) return parts.plain;
  return `$0.0${toSubscript(parts.zeroCount)}${parts.sigDigits}`;
}

export function floorBalance(balance: string, decimals = 2): string {
  const numericBalance = Number.parseFloat(balance);
  if (!Number.isFinite(numericBalance)) {
    return (0).toFixed(decimals);
  }

  const factor = 10 ** decimals;
  return (Math.floor(numericBalance * factor) / factor).toFixed(decimals);
}
