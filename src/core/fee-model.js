/**
 * Fee yield model. Uses observed fees/TVL where available; APR is a
 * descriptive annualization, not a forecast. In-range share is explicit.
 */
export function estimateFeeYield({ tvlUsd, fees24hUsd, allocationUsd, inRangeShare = 1,
  utilization = 1, captureShare = 1, gasCostUsd = 0, rebalanceCostUsd = 0 }) {
  for (const [k,v] of Object.entries({tvlUsd, fees24hUsd, allocationUsd, inRangeShare, utilization, captureShare})) {
    if (!Number.isFinite(v)) throw new Error(`${k} must be finite`);
  }
  if (tvlUsd <= 0 || allocationUsd < 0 || fees24hUsd < 0) throw new Error('Invalid TVL, fees or allocation');
  const clamp = x => Math.max(0, Math.min(1, x));
  const share = clamp(allocationUsd / tvlUsd);
  const effectiveShare = share * clamp(inRangeShare) * clamp(utilization) * clamp(captureShare);
  const grossDailyFeesUsd = fees24hUsd * effectiveShare;
  const netDailyFeesUsd = Math.max(0, grossDailyFeesUsd - Math.max(0, gasCostUsd + rebalanceCostUsd));
  return {
    poolFeeAprPct: fees24hUsd / tvlUsd * 365 * 100,
    estimatedGrossDailyFeesUsd: grossDailyFeesUsd,
    estimatedNetDailyFeesUsd: netDailyFeesUsd,
    estimatedNetAprPct: allocationUsd > 0 ? netDailyFeesUsd * 365 / allocationUsd * 100 : 0,
    allocationSharePct: share * 100,
    assumptions: { inRangeShare: clamp(inRangeShare), utilization: clamp(utilization), captureShare: clamp(captureShare) }
  };
}
