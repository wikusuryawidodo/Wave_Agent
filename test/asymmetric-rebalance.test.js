import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAsymmetricRebalance } from '../src/core/asymmetric-rebalance.js';

const position = {
  poolAddress: 'pool-a',
  entryPrice: 100,
  range: { lower: 90, upper: 110 },
  rebalanceLevelsCompleted: []
};

test('asymmetric policy holds before first rebalance level', () => {
  const result = evaluateAsymmetricRebalance({ position, currentPrice: 90, now: 100_000 });
  assert.equal(result.status, 'hold');
});

test('asymmetric policy asks for a quote at -15 percent and does not top up capital', () => {
  const result = evaluateAsymmetricRebalance({ position, currentPrice: 84, now: 100_000 });
  assert.equal(result.status, 'quote-required');
  assert.equal(result.levelPct, 15);
});

test('fresh verified router quote allows paper-only re-range using existing inventory', () => {
  const now = 1_800_000_000_000;
  const result = evaluateAsymmetricRebalance({
    position,
    currentPrice: 84,
    now,
    quote: {
      verified: true,
      source: 'read-only-router-quote',
      poolAddress: 'pool-a',
      timestamp: now,
      priceImpactBps: 20,
      residualBalancePct: 1.5,
      fundingMode: 'reuse-existing-inventory',
      additionalCapitalUsd: 0,
      range: { lower: 76, upper: 92 }
    }
  });
  assert.equal(result.status, 'rebalance-ready');
  assert.equal(result.mode, 'paper-only');
  assert.equal(result.additionalCapitalUsd, 0);
  assert.deepEqual(result.nextRange, { lower: 76, upper: 92 });
});

test('policy hard-stops at -50 percent and rejects stale or capital-adding quotes', () => {
  const now = 1_800_000_000_000;
  assert.equal(evaluateAsymmetricRebalance({ position, currentPrice: 50, now }).status, 'hard-stop');
  const stale = evaluateAsymmetricRebalance({
    position, currentPrice: 84, now,
    quote: { verified: true, source: 'read-only-router-quote', poolAddress: 'pool-a',
      timestamp: now - 60_000, priceImpactBps: 10, residualBalancePct: 1,
      range: { lower: 75, upper: 90 } }
  });
  assert.equal(stale.status, 'quote-required');
});
