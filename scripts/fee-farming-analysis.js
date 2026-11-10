import { assessLpEconomics } from '../src/core/lp-economics.js';

const base = {
  tvlUsd: 100_000,
  activeTvlUsd: 75_000,
  volume24hUsd: 150_000,
  fees24hUsd: 150,
  fees7dUsd: 1_000,
  allocationUsd: 600,
  positionFeeApr24hPct: 170,
  positionFeeApr7dPct: 160,
  volatility24hPct: 3.5,
  liquidityTrend24hPct: 0,
  stressLossPct: 5,
  expectedInventoryDragPct: 0.5,
  roundTripCostBps: 30,
  feeCaptureShare: 0.65,
  expectedHoldHours: 168,
  minPoolFeeApr24hPct: 50,
  minPoolFeeApr7dPct: 60,
  minPositionFeeApr24hPct: 120,
  minPositionFeeApr7dPct: 150,
  minNetEdgePct: 1,
  minFeeCoverageRatio: 2,
  maxFeeSpikeRatio: 2.5,
  maxInventoryDragPct7d: 1
};

const cases = [
  { name: 'Low inventory drag', overrides: { expectedInventoryDragPct: 0.25 } },
  { name: 'Normal inventory drag', overrides: { expectedInventoryDragPct: 0.5 } },
  { name: 'High inventory drag', overrides: { expectedInventoryDragPct: 0.9 } },
  { name: 'Severe inventory drag', overrides: { expectedInventoryDragPct: 1.2 } },
  { name: 'Headline APR spike only', overrides: { positionFeeApr24hPct: 600, positionFeeApr7dPct: 160 } },
  { name: 'Weak fees in proposed range', overrides: { positionFeeApr24hPct: 90, positionFeeApr7dPct: 80 } }
];

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

const results = cases.map(item => {
  const economics = assessLpEconomics({ ...base, ...item.overrides });
  const drag = Number(item.overrides?.expectedInventoryDragPct ?? base.expectedInventoryDragPct);
  const requiredAprForOnePctNet =
    (1 + 0.30 + drag) * 8760 / (168 * 0.65);
  return {
    scenario: item.name,
    eligible: economics.eligible,
    failures: economics.hardFails,
    positionFeeApr24hPct: economics.positionFeeApr24hPct,
    positionFeeApr7dPct: economics.positionFeeApr7dPct,
    grossForecastFeesPct7d: round(economics.grossPositionFeesPct),
    inventoryDragPct7d: round(drag),
    roundTripCostPct: round(economics.roundTripCostPct),
    netEdgePct7d: round(economics.expectedNetEdgePct),
    feeCoverageRatio: round(economics.feeCoverageRatio),
    requiredPositionAprFor1PctNet: round(requiredAprForOnePctNet, 1),
    expectedFeesUsdOn600: round(economics.expectedFeesUsd, 2),
    expectedInventoryDragUsdOn600: round(economics.expectedInventoryDragUsd, 2),
    roundTripCostUsdOn600: round(economics.estimatedRoundTripCostUsd, 2)
  };
});

const report = {
  title: 'Wave_Agent position-level DLMM fee farming hurdle',
  dataLabel: 'Deterministic economic sensitivity analysis; not historical trading performance or verified PositionV2 replay',
  assumptions: {
    deployedCapitalUsd: 600,
    horizonHours: 168,
    feeCaptureHaircutPct: 35,
    roundTripCostBps: 30,
    poolActiveTvlUsd: 75_000,
    poolFees24hUsd: 150,
    poolFees7dUsd: 1_000,
    candidatePositionApr24hPct: 170,
    candidatePositionApr7dPct: 160
  },
  results
};
console.log(JSON.stringify(report, null, 2));
