import { getJson } from '../providers/http.js';
const BASE = 'https://dlmm.datapi.meteora.ag';
const n = x => Number(x ?? 0);
export function createMeteoraDataAdapter({ baseUrl = BASE, fetchImpl = fetch } = {}) {
  return {
    chain: 'solana', protocol: 'meteora-dlmm', readOnly: true,
    async getPools({ page=1, pageSize=100, sortBy='tvl:desc' } = {}) {
      const u = new URL('/pools', baseUrl);
      u.searchParams.set('page', page); u.searchParams.set('page_size', pageSize); u.searchParams.set('sort_by', sortBy);
      const raw = await getJson(u, { fetchImpl });
      const list = Array.isArray(raw) ? raw : raw.data ?? raw.pools ?? [];
      return list.map(p => normalizeMeteoraPool(p));
    },
    async getPool(address) {
      return normalizeMeteoraPool(await getJson(`${baseUrl}/pools/${encodeURIComponent(address)}`, { fetchImpl }));
    },
    async getCandles(poolAddress, { from, to, resolution='1h' } = {}) {
      const u = new URL(`/pools/${encodeURIComponent(poolAddress)}/ohlcv`, baseUrl);
      if (from != null) u.searchParams.set('from', from);
      if (to != null) u.searchParams.set('to', to);
      u.searchParams.set('resolution', resolution);
      const raw = await getJson(u, { fetchImpl });
      const list = Array.isArray(raw) ? raw : raw.data ?? raw.candles ?? [];
      return list.map(c => ({ timestamp:Number(c.timestamp ?? c.time), open:n(c.open), high:n(c.high),
        low:n(c.low), close:n(c.close), volumeUsd:n(c.volume ?? c.volume_usd), volume:n(c.volume ?? c.volume_usd) }));
    }
  };
}
export function normalizeMeteoraPool(p) {
  const tokenX = p.token_x ?? p.tokenX ?? {};
  const tokenY = p.token_y ?? p.tokenY ?? {};
  return { chain:'solana', protocol:'meteora-dlmm', poolAddress:p.address ?? p.pool_address ?? p.poolAddress,
    token0: tokenX.mint ?? tokenX.address, token1: tokenY.mint ?? tokenY.address,
    symbol:`${tokenX.symbol ?? 'X'}/${tokenY.symbol ?? 'Y'}`,
    price:n(p.current_price ?? p.price), tvlUsd:n(p.tvl ?? p.tvl_usd ?? p.active_tvl),
    volume24hUsd:n(p.volume ?? p.volume_24h), fees24hUsd:n(p.fees_24h ?? p.fees24h),
    binStep:n(p.bin_step ?? p.binStep), activeBinId:n(p.active_bin_id ?? p.activeBinId),
    raw:p };
}
