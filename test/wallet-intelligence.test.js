import test from 'node:test';
import assert from 'node:assert/strict';
import { rankTopLpWallets, enrichWalletEvent, summarizeWalletActivity } from '../src/core/wallet-intelligence.js';

test('top LP wallet ranking requires fresh verified performance history', () => {
  const now = 1_800_000_000_000;
  const good = {
    address: 'wallet-top',
    verified: true,
    source: 'top-lp-wallet-index',
    updatedAt: now - 10_000,
    closedPositions: 35,
    winRatePct: 68,
    realizedPnlUsd: 850,
    feesEarnedUsd: 320,
    maxDrawdownPct: 9,
    rangeEfficiencyPct: 88
  };
  const ranked = rankTopLpWallets([
    good,
    { ...good, address: 'wallet-stale', updatedAt: now - 8_000_000 },
    { ...good, address: 'wallet-unverified', verified: false },
    { ...good, address: 'wallet-loss', realizedPnlUsd: -50 }
  ], { now });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].address, 'wallet-top');
  assert.equal(ranked[0].eligible, true);
  assert.ok(ranked[0].score >= 65);
});

test('wallet events are enriched only when a matching top LP rank exists', () => {
  const rankedWallets = [{ address: 'wallet-top', score: 90, eligible: true }];
  const good = enrichWalletEvent({ walletAddress: 'wallet-top' }, rankedWallets);
  const unknown = enrichWalletEvent({ walletAddress: 'wallet-unknown' }, rankedWallets);
  assert.equal(good.walletRankVerified, true);
  assert.equal(good.walletRankScore, 90);
  assert.equal(unknown.walletRankVerified, false);
});

test('verified wallet activity summary reports adds, removals and net quote flow', () => {
  const now = 1_800_000_000_000;
  const common = {
    verified: true, success: true,
    programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
    walletRankVerified: true, walletRankSource: 'top-lp-wallet-index',
    walletRankScore: 80, timestamp: now - 10_000
  };
  const result = summarizeWalletActivity([
    { ...common, walletAddress: 'a', eventType: 'add-liquidity', quoteAmountUsd: 100 },
    { ...common, walletAddress: 'b', eventType: 'add-liquidity', quoteAmountUsd: 200 },
    { ...common, walletAddress: 'c', eventType: 'remove-liquidity', quoteAmountUsd: 50 }
  ], { now });
  assert.equal(result.source, 'helius-wallet-monitor');
  assert.equal(result.verified, true);
  assert.equal(result.uniqueActiveWallets24h, 3);
  assert.equal(result.netQuoteFlowUsd, 250);
  assert.equal(result.addEvents, 2);
  assert.equal(result.removeEvents, 1);
});
