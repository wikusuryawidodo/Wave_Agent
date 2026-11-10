import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPairRisk } from '../src/core/pair-risk.js';
import { createDexScreenerReadOnlyAdapter } from '../src/adapters/dexscreener-readonly.js';

function pair(now, changes = {}) {
  return {
    source: 'dexscreener',
    chainId: 'solana',
    pairAddress: 'pair-address',
    baseToken: { address: 'token-mint' },
    quoteToken: { address: 'So11111111111111111111111111111111111111112' },
    pairCreatedAtMs: now - 21 * 86_400_000,
    marketCapUsd: 2_000_000,
    fdvUsd: 2_400_000,
    liquidityUsd: 400_000,
    priceChange24hPct: 12,
    txns24h: { buys: 100, sells: 60 },
    dataRetrievedAt: now,
    ...changes
  };
}

const params = now => ({
  pairEvidence: pair(now),
  poolAddress: 'pair-address',
  tokenMint: 'token-mint',
  now
});

test('pair risk accepts mature, adequately capitalized, liquid pair with two-sided flow', () => {
  const now = 1_800_000_000_000;
  const result = assessPairRisk(params(now));
  assert.equal(result.eligible, true, result.failures.join('; '));
  assert.equal(result.pairAgeDays, 21);
  assert.equal(result.marketCapUsd, 2_000_000);
  assert.equal(result.fdvToMarketCap, 1.2);
  assert.equal(result.liquidityToMarketCap, 0.2);
});

test('pair risk rejects newly created pair and micro-cap', () => {
  const now = 1_800_000_000_000;
  const result = assessPairRisk({
    ...params(now),
    pairEvidence: pair(now, {
      pairCreatedAtMs: now - 2 * 86_400_000,
      marketCapUsd: 90_000,
      fdvUsd: 120_000
    })
  });
  assert.equal(result.eligible, false);
  assert.ok(result.failures.some(x => /pair age/.test(x)));
  assert.ok(result.failures.some(x => /market cap/.test(x)));
});

test('pair risk rejects FDV dilution and thin exit liquidity', () => {
  const now = 1_800_000_000_000;
  const result = assessPairRisk({
    ...params(now),
    pairEvidence: pair(now, { fdvUsd: 9_000_000, liquidityUsd: 10_000 })
  });
  assert.equal(result.eligible, false);
  assert.ok(result.failures.some(x => /FDV/.test(x)));
  assert.ok(result.failures.some(x => /liquidity/.test(x)));
});

test('pair risk rejects one-sided flow, very low sell activity and late-pump/dump candle', () => {
  const now = 1_800_000_000_000;
  const result = assessPairRisk({
    ...params(now),
    pairEvidence: pair(now, {
      txns24h: { buys: 200, sells: 2 },
      priceChange24hPct: 80
    })
  });
  assert.equal(result.eligible, false);
  assert.ok(result.failures.some(x => /sell-side activity/.test(x)));
  assert.ok(result.failures.some(x => x.includes('buy/sell')));
  assert.ok(result.failures.some(x => /price move/.test(x)));
});

test('pair risk requires exact pair address, token mint and fresh DexScreener source', () => {
  const now = 1_800_000_000_000;
  const wrongPair = assessPairRisk({
    ...params(now),
    pairEvidence: pair(now, { pairAddress: 'other-pair' })
  });
  assert.ok(wrongPair.failures.some(x => /exactly match/.test(x)));
  const wrongMint = assessPairRisk({
    ...params(now),
    pairEvidence: pair(now, { baseToken: { address: 'other-token' }, quoteToken: { address: 'another-token' } })
  });
  assert.ok(wrongMint.failures.some(x => /token mint/.test(x)));
  const stale = assessPairRisk({
    ...params(now),
    pairEvidence: pair(now, { dataRetrievedAt: now - 300_000 })
  });
  assert.ok(stale.failures.some(x => /stale/.test(x)));
});

test('DexScreener adapter returns normalized pair age, market cap, liquidity and 24h sells', async () => {
  const now = 1_800_000_000_000;
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [{
      chainId: 'solana',
      pairAddress: 'pair-address',
      baseToken: { address: 'token-mint' },
      quoteToken: { address: 'So11111111111111111111111111111111111111112' },
      pairCreatedAt: now - 21 * 86_400_000,
      marketCap: 2_000_000,
      fdv: 2_400_000,
      liquidity: { usd: 400_000 },
      priceChange: { h24: 12 },
      txns: { h24: { buys: 100, sells: 60 } }
    }]
  });
  const adapter = createDexScreenerReadOnlyAdapter({ fetchImpl, clock: () => now });
  const evidence = await adapter.getPairEvidence({ poolAddress: 'pair-address', tokenMint: 'token-mint' });
  assert.equal(evidence.pairCreatedAtMs, now - 21 * 86_400_000);
  assert.equal(evidence.marketCapUsd, 2_000_000);
  assert.equal(evidence.txns24h.sells, 60);
});
