import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperTradingEngine } from '../src/core/paper-engine.js';

function candles({ count = 80, start = 100 } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const close = start + i * 0.05 + Math.sin(i * 1.5) * 0.4;
    return { open: close - 0.03, high: close + 0.3, low: close - 0.3, close, volume: i === count - 1 ? 1500 : 1000 };
  });
}

function snapshot(timestamp, overrides = {}) {
  const c5 = candles();
  const c30 = candles();
  return {
    timestamp,
    pool: {
      poolAddress: 'pool-test',
      chain: 'solana',
      symbol: 'TEST/SOL',
      tvlUsd: 100_000,
      volume24hUsd: 50_000,
      fees24hUsd: 100,
      dataAgeSec: 5,
      liquidityTrend24hPct: 1,
      feeVolumeConsistency: 'high'
    },
    priceUsd: c5.at(-1).close,
    candles5m: c5,
    candles30m: c30,
    walletSignals: [
      { walletAddress: 'wallet-a', eventType: 'add-liquidity', timestamp: timestamp - 20_000, quoteAmountUsd: 100, inRange: true },
      { walletAddress: 'wallet-b', eventType: 'add-liquidity', timestamp: timestamp - 10_000, quoteAmountUsd: 150, inRange: true }
    ],
    ...overrides
  };
}

function engine(options = {}) {
  return new PaperTradingEngine({ initialEquityUsd: 10_000, ...options });
}

test('hybrid entry requires multi-timeframe confirmation and distinct wallet convergence', async () => {
  const e = engine();
  const result = await e.processSnapshot(snapshot(1_800_000_000_000));
  assert.equal(result.entry.status, 'opened');
  assert.equal(result.entry.evaluation.walletCount, 2);
  assert.equal(result.portfolio.openPositions, 1);
  assert.ok(result.entry.position.reservedRiskUsd <= 50.000001);
  assert.ok(result.entry.position.allocationUsd * 8.25 / 100 <= 50.000001);
});

test('hybrid entry fails closed without enough distinct wallet groups', () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000);
  s.walletSignals = [s.walletSignals[0], { ...s.walletSignals[0], walletAddress: 'wallet-a' }];
  const evaluation = e.evaluateEntry(s, s.timestamp);
  assert.equal(evaluation.eligible, false);
  assert.match(evaluation.reason, /wallet convergence/);
});

test('stale pool data is rejected before technical evaluation', () => {
  const e = engine();
  const s = snapshot(1_800_000_000_000, { pool: { ...snapshot(1_800_000_000_000).pool, dataAgeSec: 120 } });
  const evaluation = e.evaluateEntry(s, s.timestamp);
  assert.equal(evaluation.eligible, false);
  assert.match(evaluation.reason, /stale/);
});

test('hard stop closes a paper position deterministically', async () => {
  const e = engine();
  const start = 1_800_000_000_000;
  const first = await e.processSnapshot(snapshot(start));
  assert.equal(first.entry.status, 'opened');
  const next = snapshot(start + 60_000, { inventoryPnlPct: -8.5 });
  next.walletSignals = [];
  const result = await e.processSnapshot(next);
  assert.equal(result.exits.length, 1);
  assert.equal(result.exits[0].reason, 'hard-stop-loss');
  assert.equal(result.portfolio.openPositions, 0);
});

test('dynamic trailing exit activates after profit and closes on giveback', async () => {
  const e = engine();
  const start = 1_800_000_000_000;
  await e.processSnapshot(snapshot(start));
  const up = snapshot(start + 60_000, { inventoryPnlPct: 4 });
  up.walletSignals = [];
  const armed = await e.processSnapshot(up);
  assert.equal(armed.exits.length, 0);
  const down = snapshot(start + 120_000, { inventoryPnlPct: 2.3 });
  down.walletSignals = [];
  const closed = await e.processSnapshot(down);
  assert.equal(closed.exits[0].reason, 'dynamic-trailing-stop');
});

test('AI reject recommendation is recorded as commentary and cannot veto entry', async () => {
  const e = engine({ analyst: { analyzePool: async () => ({ score: 10, recommendation: 'reject', summary: 'advisory only' }) } });
  const result = await e.processSnapshot(snapshot(1_800_000_000_000));
  assert.equal(result.entry.status, 'opened');
  assert.equal(result.entry.aiAnalysis.recommendation, 'reject');
  assert.equal(result.portfolio.openPositions, 1);
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

test('daily loss limit blocks new entries after losses reach configured threshold', async () => {
  const e = engine({ config: { maxOpenPositions: 1, stopLossPct: 50, maxDailyLossPct: 0.5 } });
  const start = 1_800_000_000_000;
  await e.processSnapshot(snapshot(start));
  const loss = snapshot(start + 60_000, { inventoryPnlPct: -1 });
  loss.walletSignals = [];
  await e.processSnapshot(loss);
  const later = snapshot(start + 120_000);
  later.pool.poolAddress = 'another-pool';
  const blocked = await e.processSnapshot(later);
  assert.equal(blocked.entry.reason, 'daily-loss-limit');
});
