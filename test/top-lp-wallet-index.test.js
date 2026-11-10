import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopLpWalletIndexAdapter } from '../src/adapters/top-lp-wallet-index.js';

const wallet = {
  address: 'wallet-a',
  updatedAt: new Date(1_800_000_000_000 - 1000).toISOString(),
  closedPositions: 40,
  winRatePct: 70,
  realizedPnlUsd: 1500,
  feesEarnedUsd: 420,
  maxDrawdownPct: 10,
  rangeEfficiencyPct: 90
};

test('top wallet index is not trusted merely because remote data claims it is', async () => {
  const adapter = createTopLpWalletIndexAdapter({
    endpoint: 'https://wallet-index.example/api',
    trusted: false,
    fetchImpl: async () => new Response(JSON.stringify({ wallets: [{ ...wallet, verified: true, source: 'top-lp-wallet-index' }] }), { status: 200 }),
    clock: () => 1_800_000_000_000
  });
  const result = await adapter.getRankedWallets();
  assert.equal(result.trusted, false);
  assert.deepEqual(result.wallets, []);
});

test('explicitly trusted top LP index returns ranked records', async () => {
  const adapter = createTopLpWalletIndexAdapter({
    endpoint: 'https://wallet-index.example/api',
    trusted: true,
    fetchImpl: async () => new Response(JSON.stringify({ wallets: [wallet] }), { status: 200 }),
    clock: () => 1_800_000_000_000
  });
  const result = await adapter.getRankedWallets();
  assert.equal(result.trusted, true);
  assert.equal(result.wallets.length, 1);
  assert.equal(result.wallets[0].address, 'wallet-a');
  assert.equal(result.wallets[0].eligible, true);
});
