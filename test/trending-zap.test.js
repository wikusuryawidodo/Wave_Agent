import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankTrendingPools,
  chooseTrendingZapRange,
  chooseDirectionalSingleSidedRange,
  evaluateTrendingZapCandidate,
  evaluateZapPositionMark
} from '../src/core/trending-zap-strategy.js';

const DAY = 86_400_000;
const now = 1_800_000_000_000;
const STABLE = 'USDG_MINT';
const TOKEN = 'TREND_TOKEN_MINT';

function makeSnapshot(overrides = {}) {
  return {
    timestamp: now,
    priceUsd: 100,
    allocationUsd: 100,
    pool: {
      poolAddress: 'trending-pair',
      baseMint: TOKEN,
      quoteMint: STABLE,
      tvlUsd: 150_000,
      activeTvlUsd: 75_000,
      volume24hUsd: 150_000,
      volume1hUsd: 12_500,
      fees24hUsd: 150,
      fees7dUsd: 1_050,
      dataAgeSec: 5,
      volatility24hPct: 5,
      liquidityTrend24hPct: 0,
      ...overrides.pool
    },
    pairEvidence: {
      source: 'dexscreener',
      chainId: 'solana',
      pairAddress: 'trending-pair',
      baseToken: { address: TOKEN },
      quoteToken: { address: STABLE },
      pairCreatedAtMs: now - 30 * DAY,
      marketCapUsd: 5_000_000,
      fdvUsd: 6_000_000,
      liquidityUsd: 500_000,
      priceChange24hPct: 12,
      txns24h: { buys: 200, sells: 100 },
      dataRetrievedAt: now,
      ...overrides.pairEvidence
    },
    security: {
      verified: true,
      mintAuthorityDisabled: true,
      freezeAuthorityDisabled: true,
      honeypot: false,
      scam: false,
      dataAgeSec: 5,
      tokenAgeDays: 30,
      marketCapUsd: 5_000_000,
      top10HoldersPct: 25,
      top10DevWalletPct: 5,
      holders: 2_000,
      ...overrides.security
    },
    lpRisk: {
      verified: true,
      source: 'meteora-bin-stress-simulator',
      feeModelVerified: true,
      feeModelSource: 'meteora-position-v2-bin-fee-replay',
      positionFeeApr24hPct: 170,
      positionFeeApr7dPct: 160,
      stressLossPct: 5,
      expectedInventoryDragPct7d: 0.5,
      simulatedRangeCoveragePct: 98,
      ...overrides.lpRisk
    },
    ...overrides
  };
}

function options(extra = {}) {
  return {
    fundingMode: 'stable-zap-inrange',
    inputMint: STABLE,
    approvedQuoteMints: [STABLE],
    assetProfile: 'trending',
    zapQuote: {
      verified: true,
      source: 'read-only-router-quote',
      compositionVerified: true,
      inputMint: STABLE,
      outputMint: TOKEN,
      quotedAtMs: now,
      inputAmountUsd: 100,
      expectedOutputAmount: 1000,
      minimumOutputAmount: 995,
      priceImpactBps: 20,
      balanceErrorPct: 2
    },
    now,
    ...extra
  };
}

test('trending rank prefers sustained volume and fee pace, rejects burst-only/low depth pools', () => {
  const ranked = rankTrendingPools([
    { poolAddress: 'healthy', volume24hUsd: 150_000, volume1hUsd: 12_500, tvlUsd: 150_000, activeTvlUsd: 75_000, fees24hUsd: 150, fees7dUsd: 1_050 },
    { poolAddress: 'burst', volume24hUsd: 150_000, volume1hUsd: 100_000, tvlUsd: 150_000, activeTvlUsd: 75_000, fees24hUsd: 2_000, fees7dUsd: 1_050 },
    { poolAddress: 'thin', volume24hUsd: 10_000, volume1hUsd: 1_000, tvlUsd: 10_000, activeTvlUsd: 1_000, fees24hUsd: 10, fees7dUsd: 70 }
  ]);
  assert.equal(ranked[0].poolAddress, 'healthy');
  assert.equal(ranked.find(x => x.poolAddress === 'healthy').eligible, true);
  assert.equal(ranked.find(x => x.poolAddress === 'burst').eligible, false);
  assert.equal(ranked.find(x => x.poolAddress === 'thin').eligible, false);
});

test('range presets widen with asset type and volatility', () => {
  assert.equal(chooseTrendingZapRange({ price: 100, volatility24hPct: 1, assetProfile: 'stable' }).halfWidthPct, 6);
  assert.equal(chooseTrendingZapRange({ price: 100, volatility24hPct: 5, assetProfile: 'trending' }).halfWidthPct, 15);
  const wild = chooseTrendingZapRange({ price: 100, volatility24hPct: 18, assetProfile: 'high-volatility' });
  assert.ok(wild.halfWidthPct >= 30 && wild.halfWidthPct <= 50);
  assert.ok(wild.lower < 100 && wild.upper > 100);
});

test('stable-only zap candidate passes with a fresh, low-impact, balanced router quote', () => {
  const result = evaluateTrendingZapCandidate(makeSnapshot(), options());
  assert.equal(result.eligible, true, result.failures?.join('; ') || result.reason);
  assert.equal(result.funding.mode, 'stable-zap-inrange');
  assert.equal(result.funding.feesActiveImmediately, true);
  assert.ok(result.range.lower < 100 && result.range.upper > 100);
  assert.ok(result.economics.expectedNetEdgePct >= 1);
});

test('stable zap rejects stale quote, high impact, bad quote mint or one-sided balance failure', () => {
  const stale = evaluateTrendingZapCandidate(makeSnapshot(), options({
    zapQuote: { ...options().zapQuote, quotedAtMs: now - 60_000 }
  }));
  assert.equal(stale.eligible, false);
  assert.match(stale.reason, /zap quote failed/);

  const impact = evaluateTrendingZapCandidate(makeSnapshot(), options({
    zapQuote: { ...options().zapQuote, priceImpactBps: 90 }
  }));
  assert.match(impact.reason, /zap quote failed/);

  const mismatch = evaluateTrendingZapCandidate(makeSnapshot(), options({
    zapQuote: { ...options().zapQuote, inputMint: 'WRONG' }
  }));
  assert.match(mismatch.reason, /zap quote failed/);
});

test('trending candidate cannot bypass pair maturity, market cap, liquidity or security gates', () => {
  const micro = evaluateTrendingZapCandidate(makeSnapshot({
    pairEvidence: { marketCapUsd: 90_000, fdvUsd: 110_000 },
    security: { marketCapUsd: 90_000 }
  }), options());
  assert.equal(micro.eligible, false);
  assert.match(micro.reason, /pair maturity/);

  const newPair = evaluateTrendingZapCandidate(makeSnapshot({
    pairEvidence: { pairCreatedAtMs: now - 2 * DAY }
  }), options());
  assert.match(newPair.reason, /pair maturity/);

  const unsafe = evaluateTrendingZapCandidate(makeSnapshot({
    security: { freezeAuthorityDisabled: false }
  }), options());
  assert.match(unsafe.reason, /security gate/);
});

test('bullish and bearish single-sided plans are outside spot and do not earn fees until activation', () => {
  const bullish = chooseDirectionalSingleSidedRange({ price: 100, volatility24hPct: 5, direction: 'bullish', assetProfile: 'trending' });
  assert.ok(bullish.lower > 100);
  assert.ok(bullish.upper > bullish.lower);
  assert.equal(bullish.feesActiveImmediately, false);

  const bearish = chooseDirectionalSingleSidedRange({ price: 100, volatility24hPct: 5, direction: 'bearish', assetProfile: 'trending' });
  assert.ok(bearish.upper < 100);
  assert.ok(bearish.lower < bearish.upper);
});

test('directional mode requires exact one-sided SDK quote and bullish range above spot', () => {
  const s = makeSnapshot();
  const args = options({
    fundingMode: 'directional-single-sided',
    inputMint: TOKEN,
    direction: 'bullish',
    zapQuote: null
  });
  const plannedRange = chooseDirectionalSingleSidedRange({
    price: 100, volatility24hPct: 5, direction: 'bullish', assetProfile: 'trending'
  });
  s.singleSidedQuote = {
    verified: true,
    source: 'meteora-sdk-readonly-quote',
    poolAddress: 'trending-pair',
    singleSidedTokenMint: TOKEN,
    composition: 'token-only',
    rangeLower: plannedRange.lower,
    rangeUpper: plannedRange.upper,
    inputAmountUsd: 100
  };
  const result = evaluateTrendingZapCandidate(s, args);
  assert.equal(result.eligible, true, result.failures?.join('; ') || result.reason);
  assert.equal(result.funding.feesActiveImmediately, false);
  assert.ok(result.range.lower > 100);

  s.singleSidedQuote = { ...s.singleSidedQuote, singleSidedTokenMint: STABLE };
  const rejected = evaluateTrendingZapCandidate(s, args);
  assert.match(rejected.reason, /single-sided/);
});

test('five-minute monitor holds fee-growing range, warns near edge and rotates immediately once out', () => {
  const openedAtMs = now;
  const first = evaluateZapPositionMark({
    timestampMs: now + 5 * 60_000,
    openedAtMs,
    price: 100,
    lower: 85,
    upper: 115,
    feesSinceLastUsd: 0.25,
    inventoryPnlUsd: -0.1,
    feesAccruedUsd: 0.25,
    roundTripCostUsd: 0.3
  });
  assert.equal(first.action, 'hold');
  assert.equal(first.state.feesAccruedUsd, 0.25);

  const near = evaluateZapPositionMark({
    timestampMs: now + 10 * 60_000,
    openedAtMs,
    price: 113,
    lower: 85,
    upper: 115,
    feesSinceLastUsd: 0.1,
    inventoryPnlUsd: 0.2,
    roundTripCostUsd: 0.3
  }, first.state);
  assert.equal(near.action, 'prepare-close');

  const out = evaluateZapPositionMark({
    timestampMs: now + 15 * 60_000,
    openedAtMs,
    price: 116,
    lower: 85,
    upper: 115,
    feesSinceLastUsd: 0.1,
    inventoryPnlUsd: -1,
    roundTripCostUsd: 0.3
  }, near.state);
  assert.equal(out.action, 'close-and-rotate');
  assert.match(out.reason, /out-of-range/);
});

test('five-minute monitor rotates after three consecutive no-fee intervals', () => {
  let state = {};
  let result;
  for (let i = 1; i <= 3; i++) {
    result = evaluateZapPositionMark({
      timestampMs: now + i * 5 * 60_000,
      openedAtMs: now,
      price: 100,
      lower: 85,
      upper: 115,
      feesSinceLastUsd: 0,
      inventoryPnlUsd: 0,
      roundTripCostUsd: 0.3
    }, state);
    state = result.state;
  }
  assert.equal(result.action, 'close-and-rotate');
  assert.match(result.reason, /fee-growth-stalled/);
});

test('monitor ignores calls faster than five-minute cadence', () => {
  const previous = { timestampMs: now, openedAtMs: now, feesAccruedUsd: 1, noFeeCount: 0 };
  const result = evaluateZapPositionMark({
    timestampMs: now + 60_000,
    openedAtMs: now,
    price: 116,
    lower: 85,
    upper: 115,
    feesSinceLastUsd: 10
  }, previous);
  assert.equal(result.action, 'wait');
});
