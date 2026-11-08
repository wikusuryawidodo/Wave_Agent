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
    txns24h: pair.txns?.h24 ? {
      buys: numberOrNull(pair.txns.h24.buys),
      sells: numberOrNull(pair.txns.h24.sells)
    } : null,
    dataRetrievedAt: Date.now(),
    raw: pair
  };
}

/** Public read-only pair enrichment. Matches exact pool address and mint. */
export function createDexScreenerReadOnlyAdapter({ baseUrl = BASE, fetchImpl = fetch, clock = Date.now } = {}) {
  return {
    provider: 'dexscreener',
    chain: 'solana',
    readOnly: true,
    async getTokenPairs(tokenMint) {
      if (!tokenMint) throw new Error('tokenMint is required');
      const url = new URL('/token-pairs/v1/solana/' + encodeURIComponent(tokenMint), baseUrl);
      const raw = await getJson(url, { fetchImpl });
      if (!Array.isArray(raw)) throw new Error('DexScreener token-pairs response is not an array');
      return raw.map(normalizePair).map(pair => ({ ...pair, dataRetrievedAt: clock() }));
    },
    async getPairEvidence({ poolAddress, tokenMint }) {
      if (!poolAddress || !tokenMint) throw new Error('poolAddress and tokenMint are required');
      const pairs = await this.getTokenPairs(tokenMint);
      const pair = pairs.find(item =>
        String(item.pairAddress).toLowerCase() === String(poolAddress).toLowerCase() &&
        [item.baseToken?.address, item.quoteToken?.address].some(address =>
          String(address ?? '').toLowerCase() === String(tokenMint).toLowerCase()
        )
      );
      if (!pair) throw new Error('DexScreener has no exact pair + mint match for the Meteora pool');
      return pair;
    }
  };
}
