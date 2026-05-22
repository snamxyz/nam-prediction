const DECIMAL_SCALE = 10n ** 12n;
const BPS_DENOM = 10000n;

function sqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let z = value;
  let y = (value + 1n) / 2n;
  while (y < z) {
    z = y;
    y = (value / y + y) / 2n;
  }
  return z;
}

// Mirrors CPMM.buyYes/buyNo: protocol fee is skimmed first, LP fee is withheld
// from AMM math, and the remaining collateral mints a complete set plus swaps
// the opposite leg into more of the desired outcome.
export function estimateBuy(
  usdcIn: bigint,
  lpFeeBps: bigint,
  protocolFeeBps: bigint,
  yesReserve: bigint,
  noReserve: bigint,
  isYes: boolean
): { sharesOut: bigint; protocolFee: bigint; netIn: bigint } {
  const protocolFee = (usdcIn * protocolFeeBps) / BPS_DENOM;
  const netIn = usdcIn - protocolFee;
  const lpFee = (netIn * lpFeeBps) / BPS_DENOM;
  const usdcAfterFee = netIn - lpFee;
  const scaledIn = usdcAfterFee * DECIMAL_SCALE;
  const k = yesReserve * noReserve;

  let sharesOut: bigint;
  if (isYes) {
    const newNoReserve = noReserve + scaledIn;
    const newYesReserve = k / newNoReserve;
    sharesOut = scaledIn + (yesReserve - newYesReserve);
  } else {
    const newYesReserve = yesReserve + scaledIn;
    const newNoReserve = k / newYesReserve;
    sharesOut = scaledIn + (noReserve - newNoReserve);
  }

  return { sharesOut, protocolFee, netIn };
}

function estimateSellGrossScaled(
  sharesIn: bigint,
  yesReserve: bigint,
  noReserve: bigint,
  isYes: boolean
): bigint {
  const k = yesReserve * noReserve;
  const counterReserve = isYes ? noReserve : yesReserve;
  const b = yesReserve + noReserve + sharesIn;
  const discriminant = b * b - 4n * sharesIn * counterReserve;
  let scaledOut = (b - sqrt(discriminant)) / 2n;
  const maxOut = sharesIn < counterReserve ? sharesIn : counterReserve;
  if (scaledOut > maxOut) scaledOut = maxOut;

  while (scaledOut > 0n) {
    const newYesReserve = isYes
      ? yesReserve + sharesIn - scaledOut
      : yesReserve - scaledOut;
    const newNoReserve = isYes
      ? noReserve - scaledOut
      : noReserve + sharesIn - scaledOut;
    if (newYesReserve * newNoReserve >= k) break;
    scaledOut -= 1n;
  }

  return scaledOut;
}

// Mirrors CPMM.sellYes/sellNo: solve the inverse complete-set AMM equation,
// then retain LP fee and route protocol fee. User receives what's left.
export function estimateSell(
  sharesIn: bigint,
  lpFeeBps: bigint,
  protocolFeeBps: bigint,
  yesReserve: bigint,
  noReserve: bigint,
  isYes: boolean
): { usdcOut: bigint; grossOut: bigint; protocolFee: bigint } {
  const scaledOut = estimateSellGrossScaled(sharesIn, yesReserve, noReserve, isYes);
  const grossOut = scaledOut / DECIMAL_SCALE;
  const lpFee = (grossOut * lpFeeBps) / BPS_DENOM;
  const afterLpFee = grossOut - lpFee;
  const protocolFee = (afterLpFee * protocolFeeBps) / BPS_DENOM;
  const usdcOut = afterLpFee - protocolFee;

  return { usdcOut, grossOut, protocolFee };
}
