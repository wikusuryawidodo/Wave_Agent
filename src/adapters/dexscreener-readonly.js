import { getJson } from '../providers/http.js';

const BASE = 'https://api.dexscreener.com';
const numberOrNull = value => value == null || value === '' ? null : Number(value);

function normalizePair(pair) {
  if (!pair || typeof pair !== 'object') throw new Error('DexScreener pair response is invalid');
  return {
    source: 'dexscreener',
    chainId: pair.chainId ?? null,
    dexId: pair.dexId ?? null,
    pairAddress: pair.pairAddress ?? null,
    baseToken: pair.baseToken ?? null,
    quoteToken: pair.quoteToken ?? null,
    pairCreatedAtMs: numberOrNull(pair.pairCreatedAt),
    marketCapUsd: numberOrNull(pair.marketCap),
    fdvUsd: numberOrNull(pair.fdv),
    liquidityUsd: numberOrNull(pair.liquidity?.usd),
    priceUsd: numberOrNull(pair.priceUsd),
    priceChange24hPct: numberOrNull(pair.priceChange?.h24),
    volume24hUsd: numberOrNull(pair.volume?.h24),
    txns24h: pair.txns?.h24 ?? null,
    dataRetrievedAt: Date.now(),
    raw: pair
  };
}

/** Public read-only pair enrichment. Match exact pool address; never take the token's largest unrelated pool. */
export function createDexScreenerReadOnlyAdapter({ baseUrl = BASE, fetchImpl = fetch } = {}) {
  return {
    provider: 'dexscreener',
    chain: 'solana',
    readOnly: true,
    async getTokenPairs(tokenMint) {
      if (!tokenMint) throw new Error('tokenMint is required');
      const raw = await getJson(`${baseUrl}/token-pairs/v1/solana/${encodeURIComponent(tokenMint)}`, { fetchImpl });
      if (!Array.isArray(raw)) throw new Error('DexScreener token-pairs response is not an array');
      return raw.map(normalizePair);
    },
    async getPairEvidence({ poolAddress, tokenMint }) {
      if (!poolAddress || !tokenMint) throw new Error('poolAddress and tokenMint are required');
      const pairs = await this.getTokenPairs(tokenMint);
      const pair = pairs.find(p => String(p.pairAddress).toLowerCase() === String(poolAddress).toLowerCase());
      if (!pair) throw new Error('DexScreener has no exact pair match for the Meteora pool');
      return pair;
    }
  };
}
