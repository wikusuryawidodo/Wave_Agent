export function normalizePoolMetrics(pool) {
  const tvlUsd=Number(pool.tvlUsd), volume24hUsd=Number(pool.volume24hUsd), fees24hUsd=Number(pool.fees24hUsd);
  if (![tvlUsd,volume24hUsd,fees24hUsd].every(Number.isFinite) || tvlUsd<=0 || volume24hUsd<0 || fees24hUsd<0)
    throw new Error('Pool metrics invalid or incomplete');
  return { ...pool, tvlUsd, volume24hUsd, fees24hUsd,
    volumeToTvl: volume24hUsd/tvlUsd,
    observedFeeAprPct: fees24hUsd/tvlUsd*365*100,
    dataQuality: fees24hUsd===0 ? 'fees-missing-or-zero' : 'observed' };
}
