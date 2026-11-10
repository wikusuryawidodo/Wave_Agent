import test from 'node:test';
import assert from 'node:assert/strict';
import { createJupiterTokenScreeningAdapter } from '../src/adapters/jupiter-token-screening.js';

test('Jupiter token adapter requires exact mint and maps screening/audit fields', async () => {
  const mint = 'TokenMintExact';
  const now = 1_800_000_000_000;
  const payload = [
    { id: 'different-mint', updatedAt: new Date(now).toISOString() },
    {
      id: mint,
      updatedAt: new Date(now - 10_000).toISOString(),
      createdAt: new Date(now - 30 * 86_400_000).toISOString(),
      mcap: 2_000_000,
      holderCount: 2_500,
      organicScore: 88,
      fees: 55,
      launchpad: 'meteora',
      dev: 'dev-authority',
      audit: {
        mintAuthorityDisabled: true,
        freezeAuthorityDisabled: true,
        topHoldersPercentage: 25,
        topDevWalletPercentage: 5,
        botHoldersPercentage: 7
      }
    }
  ];
  const adapter = createJupiterTokenScreeningAdapter({
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }),
    clock: () => now,
    developerBlocklist: ['other-dev'],
    developerBlocklistVerified: true
  });
  const token = await adapter.getTokenSnapshot(mint);
  assert.equal(token.mint, mint);
  assert.equal(token.marketCapUsd, 2_000_000);
  assert.equal(token.holders, 2_500);
  assert.equal(token.tokenAgeDays, 30);
  assert.equal(token.organicScore, 88);
  assert.equal(token.tokenFeesSol, 55);
  assert.equal(token.mintAuthorityDisabled, true);
  assert.equal(token.top10HoldersPct, 25);
  assert.equal(token.devBlocked, false);
  assert.equal(adapter.readOnly, true);
  assert.equal(adapter.sendTransaction, undefined);
});

test('Jupiter adapter keeps missing audit values unknown instead of assuming safety', async () => {
  const adapter = createJupiterTokenScreeningAdapter({
    fetchImpl: async () => new Response(JSON.stringify([{ id: 'mint', updatedAt: new Date().toISOString() }]), { status: 200 })
  });
  const token = await adapter.getTokenSnapshot('mint');
  assert.equal(token.mintAuthorityDisabled, null);
  assert.equal(token.freezeAuthorityDisabled, null);
  assert.equal(token.devBlocked, null);
});
