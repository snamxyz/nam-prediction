export function floorBalance(balance: string, decimals = 2): string {
  const numericBalance = Number.parseFloat(balance);
  if (!Number.isFinite(numericBalance)) {
    return (0).toFixed(decimals);
  }

  const factor = 10 ** decimals;
  return (Math.floor(numericBalance * factor) / factor).toFixed(decimals);
}
