import { assessPairRisk } from './pair-risk.js';
import { assessLpEconomics } from './lp-economics.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const DEFAULTS = Object.freeze({
  minTvlUsd: 25_000,
  minVolume24hUsd: 50_000,
  minVolumeVelocityRatio: 1.2,
  maxVolumeVelocityRatio: 6,
  minVolumeToActiveTvl: 0.3,
  maxVolumeToActiveTvl: 4.5,
  maxPoolDataAgeSec: 90,
  maxQuoteAgeSec: 30,
  maxZapPriceImpactBps: 50,
  maxZapBalanceErrorPct: 5,
  minPositionFeeApr24hPct: 120,
  minPositionFeeApr7dPct: 150,
  minExpectedNetEdgePct: 1,
  minFeeCoverageRatio: 2,
  maxInventoryDragPct7d: 1,
  feeCaptureShare: 0.65,
  expectedHoldHours: 168,
  roundTripCostBps: 30,
  maxStressLossPct: 8,
  minTrendingPairAgeDays: 14,
  minMarketCapUsd: 250_000,
  maxFdvToMarketCap: 2.5,
  minPairLiquidityUsd: 50_000,
  minLiquidityToMarketCap: 0.08,
  minTransactions24h: 50,
  minSells24h: 15,
  minSellBuyRatio: 0.35,
  maxSellBuyRatio: 3.5,
  minPairPriceChange24hPct: -18,
  maxPairPriceChange24hPct: 45,
  nearEdgeFraction: 0.15,
  noFeeIntervalsToExit: 3,
  monitorIntervalMs: 5 * 60_000,
  maxStagnantPositionMs: 6 * 60 * 60_000
});

function securityGate(security, config) {
  const failures = [];
  if (security?.verified !== true) failures.push('token security not verified');
  if (security?.mintAuthorityDisabled !== true) failures.push('mint authority not disabled');
  if (security?.freezeAuthorityDisabled !== true) failures.push('freeze authority not disabled');
  if (security?.honeypot !== false || security?.scam !== false) failures.push('honeypot/scam status not explicitly clear');
  if (!finite(security?.dataAgeSec) || Number(security.dataAgeSec) > 300) failures.push('token security data stale');
  if (!finite(security?.tokenAgeDays) || Number(security.tokenAgeDays) < config.minTrendingPairAgeDays) failures.push('token is too new or age unknown');
  if (!finite(security?.marketCapUsd) || Number(security.marketCapUsd) < config.minMarketCapUsd) failures.push('token market cap below minimum');
  if (!finite(security?.top10HoldersPct) || Number(security.top10HoldersPct) > 35) failures.push('holder concentration too high or unknown');
  if (!finite(security?.top10DevWalletPct) || Number(security.top10DevWalletPct) > 15) failures.push('developer concentration too high or unknown');
  if (!finite(security?.holders) || Number(security.holders) < 200) failures.push('holder count too low or unknown');
  return failures;
}

/** Ranking is deliberately volume-led, but caps pathological volume bursts and rewards persistent fees. */
export function rankTrendingPools(pools, { minVolume24hUsd = 50_000, minTvlUsd = 25_000 } = {}) {
  if (!Array.isArray(pools)) throw new Error('pools must be an array');
  return pools.map(pool => {
    const volume = Number(pool.volume24hUsd);
    const tvl = Number(pool.tvlUsd);
    const activeTvl = Number(pool.activeTvlUsd);
    const hourlyVolume = Number(pool.volume1hUsd);
    const velocity = hourlyVolume / Math.max(volume / 24, 1e-9);
    const utilization = volume / Math.max(activeTvl, 1e-9);
    const failures = [];
    if (!finite(volume) || volume < minVolume24hUsd) failures.push('24h volume below trending floor');
    if (!finite(tvl) || tvl < minTvlUsd) failures.push('TVL below floor');
    if (!finite(activeTvl) || activeTvl <= 0 || utilization < 0.3 || utilization > 4.5) failures.push('active-liquidity utilization outside band');
    if (!finite(hourlyVolume) || velocity < 1.2 || velocity > 6) failures.push('1h volume velocity outside trending band');
    if (!finite(pool.fees24hUsd) || Number(pool.fees24hUsd) <= 0 || !finite(pool.fees7dUsd) || Number(pool.fees7dUsd) <= 0) {
      failures.push('fee history unavailable');
    }
    const feePace = finite(pool.fees7dUsd) && Number(pool.fees7dUsd) > 0
      ? Number(pool.fees24hUsd) / (Number(pool.fees7dUsd) / 7) : 0;
    if (feePace < 0.5 || feePace > 2.5) failures.push('fee pace is unstable');
    const volumeScore = clamp(Math.log10(Math.max(volume, 1)) / 6, 0, 1);
    const velocityScore = clamp((velocity - 1.2) / 2.8, 0, 1);
    const liquidityScore = clamp((utilization - 0.3) / 1.2, 0, 1);
    const feeConsistencyScore = 1 - clamp(Math.abs(Math.log(Math.max(feePace, 1e-9))) / Math.log(2.5), 0, 1);
    const score = Math.round(100 * (0.35 * volumeScore + 0.25 * velocityScore + 0.15 * liquidityScore + 0.25 * feeConsistencyScore));
    return {
      poolAddress: pool.poolAddress,
      symbol: pool.symbol ?? null,
      eligible: failures.length === 0,
      failures,
      score,
      volume24hUsd: finite(volume) ? volume : null,
      volume1hUsd: finite(hourlyVolume) ? hourlyVolume : null,
      volumeVelocityRatio: finite(velocity) ? velocity : null,
      volumeToActiveTvl: finite(utilization) ? utilization : null,
      feePaceRatio: feePace
    };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}

/** Range sizing follows the supplied playbook but will not waive age/cap/security gates. */
export function chooseTrendingZapRange({ price, volatility24hPct, assetProfile = 'trending' } = {}) {
  if (!finite(price) || Number(price) <= 0 || !finite(volatility24hPct) || Number(volatility24hPct) < 0) {
    throw new Error('positive price and non-negative volatility24hPct required');
  }
  let halfWidthPct;
  if (assetProfile === 'stable' || assetProfile === 'tokenized-stock' || assetProfile === 'quiet') {
    halfWidthPct = 6;
  } else if (assetProfile === 'trending') {
    halfWidthPct = 15;
  } else if (assetProfile === 'high-volatility') {
    // New listings are still rejected by the pair-age/security gate.
    halfWidthPct = clamp(Number(volatility24hPct) * 2.5, 30, 50);
  } else {
    throw new Error('assetProfile must be stable, tokenized-stock, quiet, trending or high-volatility');
  }
  const mid = Number(price);
  return {
    assetProfile,
    halfWidthPct,
    lower: mid * (1 - halfWidthPct / 100),
    upper: mid * (1 + halfWidthPct / 100),
    lowerPricePct: -halfWidthPct,
    upperPricePct: halfWidthPct,
    nearEdgeLower: mid * (1 - halfWidthPct / 100 * 0.85),
    nearEdgeUpper: mid * (1 + halfWidthPct / 100 * 0.85)
  };
}

function validateZapQuote(zapQuote, { inputMint, outputMint, now, config }) {
  const failures = [];
  if (zapQuote?.verified !== true || zapQuote?.source !== 'read-only-router-quote') failures.push('verified read-only zap quote missing');
  if (inputMint === outputMint || zapQuote?.inputMint !== inputMint || zapQuote?.outputMint !== outputMint) failures.push('zap input/output mint mismatch');
  if (zapQuote?.compositionVerified !== true) failures.push('two-sided in-range position composition not verified');
  const ageMs = now - Number(zapQuote?.quotedAtMs);
  if (!finite(zapQuote?.quotedAtMs) || ageMs < 0 || ageMs > config.maxQuoteAgeSec * 1000) failures.push('zap quote stale');
  if (!finite(zapQuote?.priceImpactBps) || Number(zapQuote.priceImpactBps) > config.maxZapPriceImpactBps) failures.push('zap price impact too high');
  if (!finite(zapQuote?.balanceErrorPct) || Number(zapQuote.balanceErrorPct) > config.maxZapBalanceErrorPct) failures.push('zap auto-balance residual too high');
  if (!finite(zapQuote?.inputAmountUsd) || Number(zapQuote.inputAmountUsd) <= 0 ||
      !finite(zapQuote?.expectedOutputAmount) || Number(zapQuote.expectedOutputAmount) <= 0 ||
      !finite(zapQuote?.minimumOutputAmount) || Number(zapQuote.minimumOutputAmount) <= 0 ||
      Number(zapQuote?.minimumOutputAmount) > Number(zapQuote?.expectedOutputAmount)) {
    failures.push('zap quote amounts missing or invalid');
  }
  if (finite(zapQuote?.priceImpactBps) && Number(zapQuote.priceImpactBps) < 0) failures.push('zap price impact invalid');
  return failures;
}


/** Directional one-sided range is deliberately placed fully beyond spot. */
export function chooseDirectionalSingleSidedRange({ price, volatility24hPct, direction, assetProfile = 'trending' } = {}) {
  if (!['bullish', 'bearish'].includes(direction)) throw new Error('direction must be bullish or bearish');
  const balanced = chooseTrendingZapRange({ price, volatility24hPct, assetProfile });
  const widthPct = balanced.halfWidthPct * 2;
  const bufferPct = clamp(Number(volatility24hPct) * 0.25, 0.75, 3);
  const spot = Number(price);
  const lower = direction === 'bullish'
    ? spot * (1 + bufferPct / 100)
    : spot * (1 - (bufferPct + widthPct) / 100);
  const upper = direction === 'bullish'
    ? spot * (1 + (bufferPct + widthPct) / 100)
    : spot * (1 - bufferPct / 100);
  return {
    assetProfile,
    direction,
    widthPct,
    bufferPct,
    lower,
    upper,
    currentPrice: spot,
    startsOutOfRange: true,
    feesActiveImmediately: false,
    activationCondition: direction === 'bullish'
      ? 'spot trades up to the lower boundary'
      : 'spot trades down to the upper boundary'
  };
}

/**
 * Paper-only evaluation for the trending + zap strategy.
 * It only creates a proposed plan; it never constructs or broadcasts a transaction.
 */
export function evaluateTrendingZapCandidate(snapshot, {
  fundingMode = 'stable-zap-inrange',
  inputMint,
  approvedQuoteMints = [],
  assetProfile = 'trending',
  direction = 'bullish',
  zapQuote = null,
  now = Date.now(),
  config: overrides = {}
} = {}) {
  const config = { ...DEFAULTS, ...overrides };
  const pool = snapshot?.pool ?? {};
  const poolAddress = String(pool.poolAddress ?? '').trim();
  const fail = (reason, failures = []) => ({ eligible: false, reason, failures, poolAddress: poolAddress || null });
  if (!poolAddress) return fail('pool address missing');
  if (!finite(pool.dataAgeSec) || Number(pool.dataAgeSec) > config.maxPoolDataAgeSec) return fail('pool data stale');
  if (!finite(pool.tvlUsd) || Number(pool.tvlUsd) < config.minTvlUsd) return fail('TVL below floor');
  if (!finite(pool.activeTvlUsd) || Number(pool.activeTvlUsd) <= 0) return fail('active TVL missing');
  if (!finite(pool.volume24hUsd) || Number(pool.volume24hUsd) < config.minVolume24hUsd) return fail('24h volume below trending floor');
  if (!finite(pool.volume1hUsd)) return fail('1h volume data missing');
  const utilization = Number(pool.volume24hUsd) / Number(pool.activeTvlUsd);
  const velocity = Number(pool.volume1hUsd) / Math.max(Number(pool.volume24hUsd) / 24, 1e-9);
  if (utilization < config.minVolumeToActiveTvl || utilization > config.maxVolumeToActiveTvl) return fail('volume/active-TVL outside trending band');
  if (velocity < config.minVolumeVelocityRatio || velocity > config.maxVolumeVelocityRatio) return fail('1h volume velocity outside trending band');
  if (!finite(pool.fees24hUsd) || !finite(pool.fees7dUsd) || Number(pool.fees24hUsd) <= 0 || Number(pool.fees7dUsd) <= 0) return fail('24h/7d fee history missing');
  const feePaceRatio = Number(pool.fees24hUsd) / (Number(pool.fees7dUsd) / 7);
  if (feePaceRatio < 0.5 || feePaceRatio > 2.5) return fail('trending pool fee pace unstable');

  const baseMint = pool.baseMint ?? pool.tokenXMint;
  const quoteMint = pool.quoteMint ?? pool.tokenYMint;
  if (!baseMint || !quoteMint || !inputMint) return fail('base, quote and input mints are required');
  const isQuoteApproved = approvedQuoteMints.includes(quoteMint);
  if (!isQuoteApproved) return fail('quote mint is not on the configured USDG/WETH allowlist');

  const pairRisk = assessPairRisk({
    pairEvidence: snapshot.pairEvidence,
    poolAddress,
    tokenMint: baseMint,
    now,
    minPairAgeDays: config.minTrendingPairAgeDays,
    maxPairEvidenceAgeSec: 120,
    minMarketCapUsd: config.minMarketCapUsd,
    maxFdvToMarketCap: config.maxFdvToMarketCap,
    minPairLiquidityUsd: config.minPairLiquidityUsd,
    minLiquidityToMarketCap: config.minLiquidityToMarketCap,
    minTransactions24h: config.minTransactions24h,
    minSells24h: config.minSells24h,
    minSellBuyRatio: config.minSellBuyRatio,
    maxSellBuyRatio: config.maxSellBuyRatio,
    minPriceChange24hPct: config.minPairPriceChange24hPct,
    maxPriceChange24hPct: config.maxPairPriceChange24hPct
  });
  if (!pairRisk.eligible) return fail('pair maturity/market-cap/liquidity gate failed', pairRisk.failures);
  const securityFailures = securityGate(snapshot.security, config);
  if (securityFailures.length) return fail('token security gate failed', securityFailures);

  const currentPrice = Number(snapshot.priceUsd ?? snapshot.activeBinPrice ?? 0);
  let range;
  try {
    range = fundingMode === 'directional-single-sided'
      ? chooseDirectionalSingleSidedRange({ price: currentPrice, volatility24hPct: Number(pool.volatility24hPct), assetProfile, direction })
      : chooseTrendingZapRange({ price: currentPrice, volatility24hPct: Number(pool.volatility24hPct), assetProfile });
  } catch (error) {
    return fail(error.message);
  }

  let funding;
  if (fundingMode === 'stable-zap-inrange') {
    if (inputMint !== quoteMint) return fail('stable zap mode requires the configured quote asset as the only input');
    if (!(range.lower <= currentPrice && currentPrice <= range.upper)) return fail('zap range must cover the current price');
    const zapFailures = validateZapQuote(zapQuote, { inputMint, outputMint: baseMint, now, config });
    if (zapFailures.length) return fail('one-token zap quote failed validation', zapFailures);
    funding = {
      mode: fundingMode,
      inputMint,
      requiresSwap: true,
      targetState: 'two-sided-in-range',
      estimatedPriceImpactBps: Number(zapQuote.priceImpactBps),
      balanceErrorPct: Number(zapQuote.balanceErrorPct),
      feesActiveImmediately: true,
      caveat: 'One-token input is converted by a quoted swap into the two-token composition required by an in-range position.'
    };
  } else if (fundingMode === 'directional-single-sided') {
    if (!['bullish', 'bearish'].includes(direction)) return fail('direction must be bullish or bearish');
    if (inputMint !== baseMint) return fail('directional mode requires the base token as the single input');
    const expectedOutOfRange = direction === 'bullish'
      ? range.lower > currentPrice
      : range.upper < currentPrice;
    if (!expectedOutOfRange) return fail('directional single-sided range must be fully above spot for bullish or below spot for bearish');
    const single = snapshot.singleSidedQuote ?? {};
    if (single.verified !== true || single.singleSidedTokenMint !== inputMint ||
        single.source !== 'meteora-sdk-readonly-quote' || single.poolAddress !== poolAddress ||
        single.composition !== 'token-only' ||
        !finite(single.rangeLower) || !finite(single.rangeUpper) ||
        Math.abs(Number(single.rangeLower) - range.lower) / range.lower > 0.0001 ||
        Math.abs(Number(single.rangeUpper) - range.upper) / range.upper > 0.0001 ||
        !finite(single.inputAmountUsd) || Number(single.inputAmountUsd) <= 0) {
      return fail('SDK-verified single-sided bin composition quote required for exact pool, mint and range');
    }
    funding = {
      mode: fundingMode,
      direction,
      inputMint,
      requiresSwap: false,
      targetState: 'single-sided-out-of-range',
      feesActiveImmediately: false,
      feeActivationCondition: direction === 'bullish' ? 'price trades up into lower range boundary' : 'price trades down into upper range boundary',
      caveat: 'This is a directional range order, not active fee farming until price enters the range.'
    };
  } else {
    return fail('unsupported fundingMode');
  }

  const risk = snapshot.lpRisk ?? {};
  if (risk.verified !== true || risk.source !== 'meteora-bin-stress-simulator' ||
      risk.feeModelVerified !== true || risk.feeModelSource !== 'meteora-position-v2-bin-fee-replay' ||
      !finite(risk.positionFeeApr24hPct) || !finite(risk.positionFeeApr7dPct) ||
      !finite(risk.stressLossPct) || !finite(risk.expectedInventoryDragPct7d)) {
    return fail('verified position-specific fee and bin-stress replay required');
  }
  if (Number(risk.stressLossPct) > config.maxStressLossPct) return fail('bin stress loss above limit');
  let economics;
  try {
    economics = assessLpEconomics({
      tvlUsd: Number(pool.tvlUsd),
      activeTvlUsd: Number(pool.activeTvlUsd),
      volume24hUsd: Number(pool.volume24hUsd),
      fees24hUsd: Number(pool.fees24hUsd),
      fees7dUsd: Number(pool.fees7dUsd),
      positionFeeApr24hPct: Number(risk.positionFeeApr24hPct),
      positionFeeApr7dPct: Number(risk.positionFeeApr7dPct),
      allocationUsd: Number(snapshot.allocationUsd ?? 100),
      volatility24hPct: Number(pool.volatility24hPct),
      liquidityTrend24hPct: Number(pool.liquidityTrend24hPct ?? 0),
      stressLossPct: Number(risk.stressLossPct),
      expectedInventoryDragPct: Number(risk.expectedInventoryDragPct7d),
      roundTripCostBps: config.roundTripCostBps,
      feeCaptureShare: config.feeCaptureShare,
      expectedHoldHours: config.expectedHoldHours,
      minPositionFeeApr24hPct: config.minPositionFeeApr24hPct,
      minPositionFeeApr7dPct: config.minPositionFeeApr7dPct,
      minNetEdgePct: config.minExpectedNetEdgePct,
      minFeeCoverageRatio: config.minFeeCoverageRatio,
      maxInventoryDragPct7d: config.maxInventoryDragPct7d,
      maxVolatility24hPct: 20,
      maxStressLossPct: config.maxStressLossPct
    });
  } catch (error) {
    return fail('position fee economics invalid: ' + error.message);
  }
  if (!economics.eligible) return fail('position net-fee hurdle failed', economics.hardFails);

  return {
    eligible: true,
    reason: 'trending pool, one-token funding and net position fee hurdles passed',
    poolAddress,
    tokenMint: baseMint,
    quoteMint,
    pairRisk,
    range,
    funding,
    economics,
    volumeSignals: {
      volume24hUsd: Number(pool.volume24hUsd),
      volume1hUsd: Number(pool.volume1hUsd),
      volumeVelocityRatio: velocity,
      volumeToActiveTvl: utilization,
      feePaceRatio
    },
    monitoring: {
      intervalMs: config.monitorIntervalMs,
      nearEdgeFraction: config.nearEdgeFraction,
      outOfRangePolicy: 'exit-on-first-confirmed-5m-mark',
      noFeeIntervalsToExit: config.noFeeIntervalsToExit,
      maxStagnantPositionMs: config.maxStagnantPositionMs
    },
    paperOnly: true,
    executionEnabled: false
  };
}

/** Evaluate a position on each 5-minute mark; no live close transaction is created. */
export function evaluateZapPositionMark(mark, previous = {}, config = {}) {
  const settings = { ...DEFAULTS, ...config };
  const lower = Number(mark.lower);
  const upper = Number(mark.upper);
  const price = Number(mark.price);
  const now = Number(mark.timestampMs);
  if (![lower, upper, price, now].every(Number.isFinite) || lower <= 0 || upper <= lower || price <= 0) {
    throw new Error('valid timestampMs, price, lower and upper are required');
  }
  if (previous.timestampMs != null && now - Number(previous.timestampMs) < settings.monitorIntervalMs) {
    return { action: 'wait', reason: 'five-minute interval not reached', state: previous };
  }
  const inRange = price >= lower && price <= upper;
  const normalized = clamp((price - lower) / (upper - lower), 0, 1);
  const nearEdge = normalized <= settings.nearEdgeFraction || normalized >= 1 - settings.nearEdgeFraction;
  const feesDelta = finite(mark.feesSinceLastUsd) ? Math.max(0, Number(mark.feesSinceLastUsd)) : null;
  const noFeeCount = feesDelta == null || feesDelta <= 0 ? Number(previous.noFeeCount ?? 0) + 1 : 0;
  const ageMs = now - Number(mark.openedAtMs ?? previous.openedAtMs ?? now);
  const feesAccruedUsd = finite(mark.feesAccruedUsd)
    ? Math.max(0, Number(mark.feesAccruedUsd))
    : Number(previous.feesAccruedUsd ?? 0) + Math.max(0, Number(feesDelta ?? 0));
  const netPnlUsd = Number(mark.inventoryPnlUsd ?? 0) + feesAccruedUsd -
    Number(mark.roundTripCostUsd ?? 0) - Number(mark.closeCostUsd ?? 0);
  const state = {
    timestampMs: now,
    openedAtMs: Number(mark.openedAtMs ?? previous.openedAtMs ?? now),
    feesAccruedUsd,
    noFeeCount
  };
  if (!inRange) return { action: 'close-and-rotate', reason: 'out-of-range-on-five-minute-mark', inRange, netPnlUsd, state };
  if (noFeeCount >= settings.noFeeIntervalsToExit) {
    return { action: 'close-and-rotate', reason: 'fee-growth-stalled-for-three-marks', inRange, netPnlUsd, state };
  }
  if (nearEdge) return { action: 'prepare-close', reason: 'price-near-range-edge', inRange, netPnlUsd, state };
  if (ageMs >= settings.maxStagnantPositionMs && feesDelta != null && feesDelta <= 0) {
    return { action: 'close-and-rotate', reason: 'position-stagnant-six-hours', inRange, netPnlUsd, state };
  }
  if (finite(mark.minRequiredNetPnlUsd) && netPnlUsd < Number(mark.minRequiredNetPnlUsd)) {
    return { action: 'close-and-rotate', reason: 'net-pnl-below-minimum-hurdle', inRange, netPnlUsd, state };
  }
  if (feesDelta != null && feesDelta > 0) return { action: 'hold', reason: 'in-range-and-fees-growing', inRange, nearEdge, feesDelta, netPnlUsd, state };
  return { action: 'hold', reason: 'in-range-awaiting-next-fee-mark', inRange, nearEdge, feesDelta, netPnlUsd, state };
}
