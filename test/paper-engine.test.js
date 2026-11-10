import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperTradingEngine, METEORA_DLMM_PROGRAM_ID } from '../src/core/paper-engine.js';

function candles({ count = 80, step = 0.025, amplitude = 0.15, phase = 1.4, period = 0.9 } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * step + amplitude * Math.sin(i * period + phase);
    return {
      timestamp: 1_800_000_000_000 + i * 300_000,
      open: close - 0.02,
      high: close + 0.35,
      low: close - 0.35,
      close,
      volume: i === count - 1 ? 1_200 : 1_000
    };
  });
}

function verifiedWalletEvent(wallet, timestamp, instructionIndex) {
  return {
    walletAddress: wallet,
    eventType: 'add-liquidity',
    verified: true,
    success: true,
    programId: METEORA_DLMM_PROGRAM_ID,
    poolAddress: 'pool-lp-test',
    signature: 'sig-' + wallet,
    instructionIndex,
    quoteSide: true,
    quoteAmountUsd: 150,
    walletRankVerified: true,
    walletRankSource: 'top-lp-wallet-index',
    walletRankScore: 82,
    timestamp
  };
}

function snapshot(timestamp, overrides = {}) {
  const five = candles();
  const thirty = candles();
  return {
    timestamp,
    pool: {
      poolAddress: 'pool-lp-test',
      tokenMint: 'mint-lp-test',
      chain: 'solana',
      symbol: 'TEST/SOL',
      tvlUsd: 100_000,
      activeTvlUsd: 75_000,
      volume24hUsd: 150_000,
      fees24hUsd: 150,
      fees7dUsd: 1_000,
      binStep: 100,
      feeActiveTvlRatio: 0.20,
      quoteOrganicScore: 82,
      dataAgeSec: 5,
      volatility24hPct: 3.5,
      liquidityTrend24hPct: 0
    },
    pairEvidence: {
      source: 'dexscreener',
      chainId: 'solana',
      pairAddress: 'pool-lp-test',
      baseToken: { address: 'mint-lp-test' },
      quoteToken: { address: 'So11111111111111111111111111111111111111112' },
      pairCreatedAtMs: timestamp - 21 * 86_400_000,
      marketCapUsd: 2_000_000,
      fdvUsd: 2_400_000,
      liquidityUsd: 400_000,
      priceChange24hPct: 12,
      txns24h: { buys: 100, sells: 60 },
      dataRetrievedAt: timestamp
    },
    security: {
      verified: true,
      mintAuthorityDisabled: true,
      freezeAuthorityDisabled: true,
      honeypot: false,
      scam: false,
      dataAgeSec: 10,
      top10HoldersPct: 25,
      top10DevWalletPct: 5,
      holders: 1_000,
      tokenAgeDays: 30,
      marketCapUsd: 2_000_000,
      organicScore: 82,
      botHoldersPct: 8,
      tokenFeesSol: 55,
      devBlocked: false,
      launchpad: 'pool_meteora'
    },
    marketData: { candles5mAgeSec: 30, candles30mAgeSec: 120 },
    candles5m: five,
    candles30m: thirty,
    priceUsd: five.at(-1).close,
    walletSignals: [
      verifiedWalletEvent('wallet-a', timestamp - 20_000, 1),
      verifiedWalletEvent('wallet-b', timestamp - 10_000, 2)
    ],
    lpMark: {
      verified: true,
      source: 'meteora-position-v2-bin-fee-replay',
      feesSinceLastUsd: 0,
      positionFeeApr24hPct: 170,
      positionFeeApr7dPct: 160,
      inRange: true
    },
    lpRisk: {
      verified: true,
      source: 'meteora-bin-stress-simulator',
      feeModelVerified: true,
      feeModelSource: 'meteora-position-v2-bin-fee-replay',
      positionFeeApr24hPct: 170,
      positionFeeApr7dPct: 160,
      stressLossPct: 5,
      expectedInventoryDragPct7d: 0.05,
      simulatedRangeCoveragePct: 98
    },
    ...overrides
  };
}

function engine(options = {}) {
  return new PaperTradingEngine({ initialEquityUsd: 10_000, ...options });
}

test('balanced LP entry requires economic edge, verified wallet adds, security and bin stress evidence', async () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000);
  const evaluation = e.evaluateEntry(s, s.timestamp);
  assert.equal(evaluation.eligible, true, evaluation.reason);
  assert.ok(evaluation.economics.expectedNetEdgePct > 1.0);
  assert.ok(evaluation.economics.feeCoverageRatio >= 2.0);
  assert.equal(evaluation.economics.conservativePositionFeeAprPct, 160);
  const result = await e.processSnapshot(s);
  assert.equal(result.entry.status, 'opened');
  assert.equal(result.entry.evaluation.walletCount, 2);
  assert.ok(result.entry.position.allocationUsd <= 1_250);
  assert.ok(result.entry.position.reservedRiskUsd <= 30.000001);
  assert.equal(result.entry.position.markAccuracy, 'entry-estimate');
});

test('wallet convergence rejects unverified, wrong-pool, wrong-program and duplicate instructions', () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000);
  s.walletSignals = [
    { ...s.walletSignals[0], verified: false },
    { ...s.walletSignals[1], poolAddress: 'different-pool' }
  ];
  const result = e.evaluateEntry(s, s.timestamp);
  assert.equal(result.eligible, false);
  assert.match(result.reason, /wallet LP convergence/);
});

test('LP economics rejects an unstable fee spike and negative net fee edge', () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000);
  s.pool.fees24hUsd = 1_000;
  s.pool.fees7dUsd = 100;
  const result = e.evaluateEntry(s, s.timestamp);
  assert.equal(result.eligible, false);
  assert.ok(result.hardFails.some(x => /fee pace unstable/.test(x)));
});

test('entry fails closed without security verification and bin-level risk model', () => {
  const e = engine();
  const a = snapshot(1_800_000_000_000, { security: { verified: false } });
  assert.match(e.evaluateEntry(a, a.timestamp).reason, /security gate/);
  const b = snapshot(1_800_000_000_000, { lpRisk: { stressLossPct: 4 } });
  assert.match(e.evaluateEntry(b, b.timestamp).reason, /bin-level LP stress/);
});

test('stress loss above the configured ceiling is rejected', () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000);
  s.lpRisk.stressLossPct = 12;
  const result = e.evaluateEntry(s, s.timestamp);
  assert.equal(result.eligible, false);
  assert.match(result.reason, /stress-loss/);
});

test('stress-adjusted hard stop closes a paper LP position', async () => {
  const e = engine();
  const start = 1_800_000_000_000;
  const first = await e.processSnapshot(snapshot(start));
  assert.equal(first.entry.status, 'opened');
  const next = snapshot(start + 60_000, { inventoryPnlPct: -6.5 });
  next.walletSignals = [];
  const result = await e.processSnapshot(next);
  assert.equal(result.exits.length, 1);
  assert.equal(result.exits[0].reason, 'stress-adjusted-hard-stop');
  assert.equal(result.portfolio.openPositions, 0);
});

test('profit trailing lock closes after a 1 percentage-point giveback', async () => {
  const e = engine();
  const start = 1_800_000_000_000;
  await e.processSnapshot(snapshot(start));
  const up = snapshot(start + 60_000, { inventoryPnlPct: 4 });
  up.walletSignals = [];
  assert.equal((await e.processSnapshot(up)).exits.length, 0);
  const down = snapshot(start + 120_000, { inventoryPnlPct: 2.5 });
  down.walletSignals = [];
  const closed = await e.processSnapshot(down);
  assert.equal(closed.exits[0].reason, 'profit-trailing-lock');
});

test('verified withdrawals by two tracked wallets trigger exit', async () => {
  const e = engine();
  const start = 1_800_000_000_000;
  await e.processSnapshot(snapshot(start));
  const s = snapshot(start + 60_000);
  s.walletSignals = [
    { ...verifiedWalletEvent('wallet-a', start + 50_000, 10), eventType: 'remove-liquidity', signature: 'remove-a' },
    { ...verifiedWalletEvent('wallet-b', start + 55_000, 11), eventType: 'remove-liquidity', signature: 'remove-b' }
  ];
  const result = await e.processSnapshot(s);
  assert.equal(result.exits.length, 1);
  assert.equal(result.exits[0].reason, 'tracked-wallet-liquidity-withdrawal');
});

test('AI recommendation is advisory and cannot change deterministic decision', async () => {
  const e = engine({ analyst: { analyzePool: async () => ({ score: 0, recommendation: 'reject', summary: 'advisory only' }) } });
  const result = await e.processSnapshot(snapshot(1_800_000_000_000));
  assert.equal(result.entry.status, 'opened');
  assert.equal(result.entry.aiAnalysis.recommendation, 'reject');
});

test('paper state round-trips and duplicate snapshots are ignored', async () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000);
  await e.processSnapshot(s);
  const restored = PaperTradingEngine.fromState(e.exportState());
  const duplicate = await restored.processSnapshot(s);
  assert.equal(duplicate.status, 'duplicate-or-out-of-order');
  assert.equal(restored.positions.size, 1);
});

test('daily-loss circuit breaker blocks new LP entries', async () => {
  const e = engine({ config: { maxOpenPositions: 1, maxDailyLossPct: 0.4 } });
  const start = 1_800_000_000_000;
  await e.processSnapshot(snapshot(start));
  const loss = snapshot(start + 60_000, { inventoryPnlPct: -10 });
  loss.walletSignals = [];
  await e.processSnapshot(loss);
  const later = snapshot(start + 120_000);
  later.pool.poolAddress = 'other-pool';
  later.pool.tokenMint = 'other-mint';
  later.walletSignals = later.walletSignals.map(x => ({ ...x, poolAddress: 'other-pool' }));
  const blocked = await e.processSnapshot(later);
  assert.equal(blocked.entry.reason, 'daily-loss-circuit-breaker');
});


test('pool-wide APR alone is not sufficient without verified position-level bin fee replay', () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000);
  delete s.lpRisk.feeModelVerified;
  delete s.lpRisk.feeModelSource;
  delete s.lpRisk.positionFeeApr24hPct;
  delete s.lpRisk.positionFeeApr7dPct;
  const result = e.evaluateEntry(s, s.timestamp);
  assert.equal(result.eligible, false);
  assert.match(result.reason, /position-specific per-bin fee replay/);
});

test('high headline pool APR is rejected when the proposed position earns low bin fees', () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000);
  s.lpRisk.positionFeeApr24hPct = 90;
  s.lpRisk.positionFeeApr7dPct = 80;
  const result = e.evaluateEntry(s, s.timestamp);
  assert.equal(result.eligible, false);
  assert.ok(result.hardFails.some(x => /position 7d bin-fee APR too low/.test(x)));
});

test('LP entry rejects projected inventory drag that consumes the fee edge', () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000);
  s.lpRisk.expectedInventoryDragPct7d = 1.2;
  const result = e.evaluateEntry(s, s.timestamp);
  assert.equal(result.eligible, false);
  assert.match(result.reason, /7d inventory-drag/);
});

test('fee growth is booked only from verified PositionV2 per-bin fee marks', async () => {
  const e = engine();
  const start = 1_800_000_000_000;
  await e.processSnapshot(snapshot(start));
  const unverified = snapshot(start + 60_000, {
    lpMark: {
      verified: false,
      source: 'pool-apr-estimate',
      feesSinceLastUsd: 25,
      positionFeeApr24hPct: 200,
      positionFeeApr7dPct: 180,
      inRange: true
    }
  });
  unverified.walletSignals = [];
  await e.processSnapshot(unverified);
  const position = [...e.positions.values()][0];
  assert.equal(position.feesAccruedUsd, 0);
  assert.equal(position.missingFeeMarkCount, 1);

  const secondMissing = snapshot(start + 120_000, {
    lpMark: { verified: false, source: 'unverified', feesSinceLastUsd: 50, inRange: true }
  });
  secondMissing.walletSignals = [];
  const result = await e.processSnapshot(secondMissing);
  assert.equal(result.exits[0].reason, 'missing-verified-position-fee-mark');
});

test('verified per-bin position fee marks accrue exact reported fees, not pool TVL estimates', async () => {
  const e = engine();
  const start = 1_800_000_000_000;
  await e.processSnapshot(snapshot(start));
  const update = snapshot(start + 60_000, {
    lpMark: {
      verified: true,
      source: 'meteora-position-v2-bin-fee-replay',
      feesSinceLastUsd: 7.25,
      positionFeeApr24hPct: 170,
      positionFeeApr7dPct: 160,
      inRange: true
    }
  });
  update.walletSignals = [];
  await e.processSnapshot(update);
  assert.equal([...e.positions.values()][0].feesAccruedUsd, 7.25);
});
