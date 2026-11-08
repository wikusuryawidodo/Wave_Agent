const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function requiredPositive(name, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive`);
  return number;
}

/**
 * Conservative fee-edge estimate for a DLMM LP candidate.
 * Fee APR uses the lower of observed 24h and trailing-7d annualizations.
 * Inventory stress/drag values must be supplied by the bin-risk simulator.
 */
export function assessLpEconomics({
  tvlUsd,
  activeTvlUsd,
  volume24hUsd,
  fees24hUsd,
  fees7dUsd,
  allocationUsd,
  volatility24hPct,
  liquidityTrend24hPct,
  stressLossPct,
  expectedInventoryDragPct,
  roundTripCostBps = 30,
  feeCaptureShare = 0.65,
  expectedHoldHours = 168,
  minFeeApr7dPct = 35,
  minFeeApr24hPct = 20,
  minNetEdgePct = 0.1,
  maxFeeSpikeRatio = 2.5,
  minActiveTvlRatio = 0.3,
  minVolumeToActiveTvl = 0.2,
  maxVolumeToActiveTvl = 5,
  maxVolatility24hPct = 8,
  maxStressLossPct = 8,
  maxLiquidityOutflowPct = -8
} = {}) {
  const totalTvl = requiredPositive('tvlUsd', tvlUsd);
  const activeTvl = requiredPositive('activeTvlUsd', activeTvlUsd);
  const volume = requiredPositive('volume24hUsd', volume24hUsd);
  const fees24h = Number(fees24hUsd);
  const fees7d = Number(fees7dUsd);
  const allocation = requiredPositive('allocationUsd', allocationUsd);
  const volatility = Number(volatility24hPct);
  const liquidityTrend = Number(liquidityTrend24hPct);
  const stress = Number(stressLossPct);
  const inventoryDrag = Number(expectedInventoryDragPct);

  if (![fees24h, fees7d, volatility, liquidityTrend, stress, inventoryDrag].every(Number.isFinite) ||
      fees24h < 0 || fees7d <= 0 || volatility < 0 || stress < 0 || inventoryDrag < 0) {
    throw new Error('Fee, volatility, liquidity trend and bin-risk inputs must be valid');
  }
  if (activeTvl > totalTvl * 1.001) throw new Error('activeTvlUsd cannot exceed total tvlUsd');
  if (!(feeCaptureShare > 0 && feeCaptureShare <= 1)) throw new Error('feeCaptureShare must be within (0,1]');

  const feeApr24hPct = fees24h / activeTvl * 365 * 100;
  const feeApr7dPct = (fees7d / 7) / activeTvl * 365 * 100;
  const conservativeFeeAprPct = Math.min(feeApr24hPct, feeApr7dPct);
  const feeStabilityRatio = fees24h / (fees7d / 7);
  const activeTvlRatio = activeTvl / totalTvl;
  const volumeToActiveTvl = volume / activeTvl;
  const expectedFeesPct = conservativeFeeAprPct * expectedHoldHours / 8760 * feeCaptureShare;
  const roundTripCostPct = roundTripCostBps / 100;
  const expectedNetEdgePct = expectedFeesPct - roundTripCostPct - inventoryDrag;

  const hardFails = [];
  if (activeTvlRatio < minActiveTvlRatio) hardFails.push('active liquidity share too low');
  if (volumeToActiveTvl < minVolumeToActiveTvl || volumeToActiveTvl > maxVolumeToActiveTvl) hardFails.push('volume/active-TVL outside healthy band');
  if (feeApr7dPct < minFeeApr7dPct) hardFails.push('7d active-liquidity fee APR too low');
  if (feeApr24hPct < minFeeApr24hPct) hardFails.push('24h active-liquidity fee APR too low');
  if (feeStabilityRatio < 0.5 || feeStabilityRatio > maxFeeSpikeRatio) hardFails.push('24h fee pace unstable versus 7d baseline');
  if (volatility > maxVolatility24hPct) hardFails.push('24h volatility too high for balanced LP range');
  if (stress > maxStressLossPct) hardFails.push('bin stress loss exceeds risk ceiling');
  if (liquidityTrend < maxLiquidityOutflowPct) hardFails.push('pool liquidity outflow too severe');
  if (expectedNetEdgePct < minNetEdgePct) hardFails.push('expected net fee edge does not cover costs and inventory drag');

  return {
    eligible: hardFails.length === 0,
    hardFails,
    feeApr24hPct,
    feeApr7dPct,
    conservativeFeeAprPct,
    feeStabilityRatio,
    activeTvlRatio,
    volumeToActiveTvl,
    expectedFeesPct,
    roundTripCostPct,
    expectedInventoryDragPct: inventoryDrag,
    expectedNetEdgePct,
    stressLossPct: stress,
    assumptions: { feeCaptureShare, expectedHoldHours, roundTripCostBps }
  };
}

/** Derive position notional from the smaller of stop/stress loss and portfolio risk limits. */
export function sizeLpPosition({
  equityUsd,
  cashUsd,
  reservedRiskUsd = 0,
  riskPerPositionPct = 0.003,
  maxPortfolioRiskPct = 0.006,
  maxPositionAllocationPct = 0.125,
  stopLossPct = 5,
  stressLossPct,
  roundTripCostBps = 30
} = {}) {
  const equity = requiredPositive('equityUsd', equityUsd);
  const cash = requiredPositive('cashUsd', cashUsd);
  const stress = requiredPositive('stressLossPct', stressLossPct);
  const worstLossPct = Math.max(stopLossPct, stress) + roundTripCostBps / 100;
  const positionRiskBudgetUsd = Math.min(
    equity * riskPerPositionPct,
    Math.max(0, equity * maxPortfolioRiskPct - reservedRiskUsd)
  );
  const allocationUsd = Math.min(
    positionRiskBudgetUsd / (worstLossPct / 100),
    equity * maxPositionAllocationPct,
    cash
  );
  return {
    allocationUsd,
    positionRiskBudgetUsd,
    worstLossPct,
    reservedRiskUsd: allocationUsd * worstLossPct / 100,
    riskBudgetUsedPct: equity ? allocationUsd * worstLossPct / 100 / equity * 100 : 0
  };
}
