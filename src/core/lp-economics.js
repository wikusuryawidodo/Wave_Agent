function requiredPositive(name, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(name + ' must be positive');
  return number;
}

/**
 * Evaluates the return on the candidate LP position, not pool-level headline APR.
 * positionFeeApr values must be produced by a range-specific, per-bin fee-share replay.
 */
export function assessLpEconomics({
  tvlUsd,
  activeTvlUsd,
  volume24hUsd,
  fees24hUsd,
  fees7dUsd,
  positionFeeApr24hPct,
  positionFeeApr7dPct,
  allocationUsd,
  volatility24hPct,
  liquidityTrend24hPct,
  stressLossPct,
  expectedInventoryDragPct,
  roundTripCostBps = 30,
  feeCaptureShare = 0.65,
  expectedHoldHours = 168,
  minPoolFeeApr7dPct = 60,
  minPoolFeeApr24hPct = 50,
  minPositionFeeApr7dPct = 150,
  minPositionFeeApr24hPct = 120,
  minNetEdgePct = 1.0,
  minFeeCoverageRatio = 2.0,
  maxFeeSpikeRatio = 2.5,
  minActiveTvlRatio = 0.3,
  minVolumeToActiveTvl = 0.2,
  maxVolumeToActiveTvl = 4.5,
  maxVolatility24hPct = 7,
  maxStressLossPct = 8,
  maxInventoryDragPct7d = 1.0,
  maxLiquidityOutflowPct = -8
} = {}) {
  const totalTvl = requiredPositive('tvlUsd', tvlUsd);
  const activeTvl = requiredPositive('activeTvlUsd', activeTvlUsd);
  const volume = requiredPositive('volume24hUsd', volume24hUsd);
  const allocation = requiredPositive('allocationUsd', allocationUsd);
  const fees24h = Number(fees24hUsd);
  const fees7d = Number(fees7dUsd);
  const positionFee24h = Number(positionFeeApr24hPct);
  const positionFee7d = Number(positionFeeApr7dPct);
  const volatility = Number(volatility24hPct);
  const liquidityTrend = Number(liquidityTrend24hPct);
  const stress = Number(stressLossPct);
  const inventoryDrag = Number(expectedInventoryDragPct);

  if (![fees24h, fees7d, positionFee24h, positionFee7d, volatility, liquidityTrend, stress, inventoryDrag].every(Number.isFinite) ||
      fees24h < 0 || fees7d <= 0 || positionFee24h < 0 || positionFee7d <= 0 ||
      volatility < 0 || stress < 0 || inventoryDrag < 0) {
    throw new Error('Pool fees, position fee APR, volatility, liquidity trend and bin-risk inputs must be valid');
  }
  if (activeTvl > totalTvl * 1.001) throw new Error('activeTvlUsd cannot exceed total tvlUsd');
  if (!(feeCaptureShare > 0 && feeCaptureShare <= 1)) throw new Error('feeCaptureShare must be within (0,1]');
  if (!(expectedHoldHours > 0 && expectedHoldHours <= 24 * 30)) throw new Error('expectedHoldHours must be >0 and <=30 days');

  // Whole-pool APR is a liquidity/market sanity check only, never the LP's forecast.
  const poolFeeApr24hPct = fees24h / activeTvl * 365 * 100;
  const poolFeeApr7dPct = (fees7d / 7) / activeTvl * 365 * 100;
  const poolFeePaceRatio = fees24h / (fees7d / 7);
  const activeTvlRatio = activeTvl / totalTvl;
  const volumeToActiveTvl = volume / activeTvl;

  // The candidate position's fee APR is based on simulated fee growth and the LP's
  // liquidity share in every bin traversed by historical/replayed swaps.
  const conservativePositionFeeAprPct = Math.min(positionFee24h, positionFee7d);
  const positionFeePaceRatio = positionFee24h / positionFee7d;
  const grossPositionFeesPct = conservativePositionFeeAprPct * expectedHoldHours / 8760 * feeCaptureShare;
  const roundTripCostPct = roundTripCostBps / 100;
  const allInDragPct = roundTripCostPct + inventoryDrag;
  const expectedNetEdgePct = grossPositionFeesPct - allInDragPct;
  const feeCoverageRatio = allInDragPct > 0 ? grossPositionFeesPct / allInDragPct : Infinity;
  const requiredPositionFeeAprPct =
    (minNetEdgePct + allInDragPct) * 8760 / (expectedHoldHours * feeCaptureShare);
  const expectedFeesUsd = allocation * grossPositionFeesPct / 100;
  const expectedInventoryDragUsd = allocation * inventoryDrag / 100;
  const estimatedRoundTripCostUsd = allocation * roundTripCostPct / 100;

  const hardFails = [];
  if (activeTvlRatio < minActiveTvlRatio) hardFails.push('active liquidity share too low');
  if (volumeToActiveTvl < minVolumeToActiveTvl || volumeToActiveTvl > maxVolumeToActiveTvl) {
    hardFails.push('volume/active-TVL outside healthy band');
  }
  if (poolFeeApr7dPct < minPoolFeeApr7dPct) hardFails.push('7d whole-pool active-TVL fee APR too low');
  if (poolFeeApr24hPct < minPoolFeeApr24hPct) hardFails.push('24h whole-pool active-TVL fee APR too low');
  if (poolFeePaceRatio < 0.5 || poolFeePaceRatio > maxFeeSpikeRatio) {
    hardFails.push('whole-pool 24h fee pace unstable versus 7d baseline');
  }
  if (positionFee7d < minPositionFeeApr7dPct) hardFails.push('simulated position 7d bin-fee APR too low');
  if (positionFee24h < minPositionFeeApr24hPct) hardFails.push('simulated position 24h bin-fee APR too low');
  if (positionFeePaceRatio < 0.5 || positionFeePaceRatio > maxFeeSpikeRatio) {
    hardFails.push('position-specific fee pace unstable versus 7d baseline');
  }
  if (volatility > maxVolatility24hPct) hardFails.push('24h volatility too high for balanced LP range');
  if (stress > maxStressLossPct) hardFails.push('bin stress loss exceeds risk ceiling');
  if (inventoryDrag > maxInventoryDragPct7d) hardFails.push('7d expected inventory loss exceeds ceiling');
  if (liquidityTrend < maxLiquidityOutflowPct) hardFails.push('pool liquidity outflow too severe');
  if (feeCoverageRatio < minFeeCoverageRatio) hardFails.push('projected position fees do not cover inventory loss plus costs by required multiple');
  if (expectedNetEdgePct < minNetEdgePct) hardFails.push('projected net fee return below minimum hurdle');

  return {
    eligible: hardFails.length === 0,
    hardFails,
    poolFeeApr24hPct,
    poolFeeApr7dPct,
    poolFeePaceRatio,
    positionFeeApr24hPct: positionFee24h,
    positionFeeApr7dPct: positionFee7d,
    conservativePositionFeeAprPct,
    positionFeePaceRatio,
    grossPositionFeesPct,
    roundTripCostPct,
    expectedInventoryDragPct: inventoryDrag,
    allInDragPct,
    expectedNetEdgePct,
    feeCoverageRatio,
    requiredPositionFeeAprPct,
    expectedFeesUsd,
    expectedInventoryDragUsd,
    estimatedRoundTripCostUsd,
    stressLossPct: stress,
    assumptions: {
      feeCaptureShare,
      expectedHoldHours,
      roundTripCostBps,
      minNetEdgePct,
      minFeeCoverageRatio
    }
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
