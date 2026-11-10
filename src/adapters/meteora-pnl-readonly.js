import { getJson } from '../providers/http.js';

const BASE = 'https://dlmm.datapi.meteora.ag';
const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.pools)) return payload.pools;
  return [];
}

/**
 * Read-only PnL source following Meridian's Meteora portfolio + per-pool PnL
 * approach. RPC fallback is injected and is never allowed to sign or submit.
 */
export function createMeteoraPnLReadOnlyAdapter({
  baseUrl = BASE,
  fetchImpl = fetch,
  rpcFallback = null,
  clock = Date.now
} = {}) {
  async function getPortfolio(walletAddress) {
    if (!walletAddress) throw new Error('walletAddress is required');
    const payload = await getJson(new URL('/portfolio/open?user=' + encodeURIComponent(walletAddress), baseUrl), { fetchImpl });
    return {
      source: 'meteora-portfolio-api',
      walletAddress,
      retrievedAt: clock(),
      raw: payload,
      positions: rowsFrom(payload).flatMap(row => {
        const nested = Array.isArray(row.positions) ? row.positions : [row];
        return nested.map(position => normalizePosition(position, row, clock));
      }).filter(Boolean)
    };
  }

  async function getPoolPnl(poolAddress, walletAddress) {
    if (!poolAddress || !walletAddress) throw new Error('poolAddress and walletAddress are required');
    const url = new URL('/positions/' + encodeURIComponent(poolAddress) + '/pnl', baseUrl);
    url.searchParams.set('user', walletAddress);
    url.searchParams.set('status', 'open');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('page', '1');
    const payload = await getJson(url, { fetchImpl });
    const positions = rowsFrom(payload).map(position => normalizePosition(position, { poolAddress }, clock));
    return { source: 'meteora-position-pnl-api', poolAddress, walletAddress, retrievedAt: clock(), positions: positions.filter(Boolean), raw: payload };
  }

  async function getPositions(walletAddress, { poolAddresses = [], allowRpcFallback = true } = {}) {
    try {
      const portfolio = await getPortfolio(walletAddress);
      if (poolAddresses.length) {
        const details = await Promise.all(poolAddresses.map(pool => getPoolPnl(pool, walletAddress)));
        const detailMap = new Map(details.flatMap(x => x.positions).map(p => [p.positionAddress, p]));
        portfolio.positions = portfolio.positions.map(p => ({ ...p, ...(detailMap.get(p.positionAddress) ?? {}) }));
      }
      return { ...portfolio, fallbackUsed: false };
    } catch (error) {
      if (!allowRpcFallback || typeof rpcFallback !== 'function') throw error;
      const fallback = await rpcFallback(walletAddress);
      if (!fallback || fallback.readOnly !== true || !Array.isArray(fallback.positions)) {
        throw new Error('RPC PnL fallback returned an invalid or non-read-only result');
      }
      return {
        source: 'meteora-sdk-rpc-fallback',
        walletAddress,
        retrievedAt: clock(),
        positions: fallback.positions.map(p => normalizePosition(p, {}, clock)).filter(Boolean),
        fallbackUsed: true,
        primaryError: error.message
      };
    }
  }

  return {
    provider: 'meteora-pnl-readonly',
    readOnly: true,
    getPortfolio,
    getPoolPnl,
    getPositions,
    executionEnabled: false
  };
}

function normalizePosition(position, parent, clock = Date.now()) {
  if (!position || typeof position !== 'object') return null;
  const positionAddress = position.positionAddress ?? position.position ?? position.publicKey ?? position.address;
  const poolAddress = position.poolAddress ?? position.pool ?? parent.poolAddress ?? parent.address;
  return {
    positionAddress: positionAddress ? String(positionAddress) : null,
    poolAddress: poolAddress ? String(poolAddress) : null,
    mint: position.baseMint ?? position.tokenMint ?? position.mint ?? null,
    totalValueUsd: numeric(position.total_value_true_usd ?? position.totalValueUsd ?? position.total_value_usd ?? position.valueUsd),
    pnlUsd: numeric(position.pnl_true_usd ?? position.pnlUsd ?? position.pnl_usd),
    pnlPct: numeric(position.pnl_pct_derived ?? position.pnlPct ?? position.pnl_pct),
    unclaimedFeesUsd: numeric(position.unclaimed_fees_true_usd ?? position.unclaimedFeesUsd ?? position.unclaimed_fees_usd),
    collectedFeesUsd: numeric(position.collected_fees_true_usd ?? position.collectedFeesUsd ?? position.collected_fees_usd),
    inRange: typeof position.in_range === 'boolean' ? position.in_range : typeof position.inRange === 'boolean' ? position.inRange : null,
    pnlMarkSuspicious: Boolean(position.pnl_pct_suspicious ?? position.pnlMarkSuspicious),
    retrievedAt: clock(),
    raw: position
  };
}
