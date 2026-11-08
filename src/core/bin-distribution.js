/** Meteora DLMM discrete-bin planner. Price convention and binStep must match
 * the pool's token X/Y orientation; this planner never guesses token order. */
export function buildBinDistribution({ activeBinId, binStepBps, lowerBinId, upperBinId,
  totalLiquidityUsd, shape = 'bell' }) {
  if (![activeBinId, binStepBps, lowerBinId, upperBinId, totalLiquidityUsd].every(Number.isFinite) ||
      binStepBps <= 0 || upperBinId < lowerBinId || totalLiquidityUsd <= 0)
    throw new Error('Invalid bin distribution inputs');
  const bins = [];
  for (let id = lowerBinId; id <= upperBinId; id++) {
    const distance = Math.abs(id - activeBinId);
    const weight = shape === 'uniform' ? 1 : 1 / (1 + distance);
    bins.push({ binId: id, relativePrice: Math.pow(1 + binStepBps / 10_000, id - activeBinId), weight });
  }
  const sum = bins.reduce((a,b) => a + b.weight, 0);
  return bins.map(b => ({ ...b, weight: b.weight / sum, allocationUsd: totalLiquidityUsd * b.weight / sum }));
}
