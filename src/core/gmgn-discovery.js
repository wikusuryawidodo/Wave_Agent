const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Converts GMGN token-ranking records into a cautious discovery shortlist.
 * This is NOT an LP-entry signal: callers must resolve the exact Meteora LB pair
 * and re-run the independent pair-age, token-security, per-bin fee and IL gates.
 */
export function rankGmgnDiscoveryTokens(items, {
  now = Date.now(),
  minMarketCapUsd = 250_000,
  minLiquidityUsd = 50_000,
  minTokenAgeDays = 14,
  maxRugRatio = 0.3,
  maxTop10HolderRate = 0.35,
  maxInsiderRate = 0.3,
  maxBundlerRate = 0.3,
  maxPriceChangePercent = 100,
  minSmartDegenCount = 1,
  limit = 20
} = {}) {
  if (!Array.isArray(items)) throw new Error('GMGN trending items must be an array');
  if (!Number.isFinite(now)) throw new Error('now must be a timestamp in milliseconds');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1..100');

  return items.map((item, itemIndex) => {
    const failures = [];
    const address = String(item.address ?? '').trim();
    const chain = String(item.chain ?? '').trim();
    const marketCapUsd = Number(item.market_cap);
    const liquidityUsd = Number(item.liquidity);
    const volumeUsd = Number(item.volume);
    const swaps = Number(item.swaps);
    const tokenCreatedAtMs = Number(item.creation_timestamp) * 1000;
    const tokenAgeDays = (now - tokenCreatedAtMs) / 86_400_000;
    const rugRatio = Number(item.rug_ratio ?? 1);
    const top10 = Number(item.top_10_holder_rate ?? 1);
    const insider = Number(item.rat_trader_amount_rate ?? 1);
    const bundler = Number(item.bundler_rate ?? 1);
    const washTrading = item.is_wash_trading;
    const smartMoney = Number(item.smart_degen_count ?? 0);
    const renowned = Number(item.renowned_count ?? 0);
    const hotLevel = Number(item.hot_level ?? 0);
    const rankPosition = Number(item.rank);
    const priceChangePct = Number(item.price_change_percent ?? item.price_change_percent1h ?? 0);
    const buys = Number(item.buys ?? 0);
    const sells = Number(item.sells ?? 0);

    if (!address || !chain) failures.push('token address or chain missing');
    if (!finite(item.market_cap) || marketCapUsd < minMarketCapUsd) failures.push('market cap below floor or unavailable');
    if (!finite(item.liquidity) || liquidityUsd < minLiquidityUsd) failures.push('liquidity below floor or unavailable');
    if (!finite(item.volume) || volumeUsd <= 0 || !finite(item.swaps) || swaps <= 0) failures.push('trading volume or swap activity missing');
    if (!finite(item.creation_timestamp) || tokenCreatedAtMs <= 0 || tokenCreatedAtMs > now || tokenAgeDays < minTokenAgeDays) {
      failures.push('token younger than minimum age or age unknown');
    }
    if (!finite(item.rug_ratio) || rugRatio > maxRugRatio || rugRatio < 0) failures.push('GMGN rug ratio too high or unavailable');
    if (washTrading !== false) failures.push('wash trading is present or not explicitly clear');
    if (!finite(item.top_10_holder_rate) || top10 > maxTop10HolderRate || top10 < 0) failures.push('top-10 concentration too high or unavailable');
    if (!finite(item.rat_trader_amount_rate) || insider > maxInsiderRate || insider < 0) failures.push('insider trading ratio too high or unavailable');
    if (!finite(item.bundler_rate) || bundler > maxBundlerRate || bundler < 0) failures.push('bundler ratio too high or unavailable');
    if (smartMoney < minSmartDegenCount) failures.push('smart-money holder count below minimum');
    if (!finite(item.price_change_percent ?? item.price_change_percent1h) || priceChangePct > maxPriceChangePercent) {
      failures.push('price move too extended or unavailable');
    }
    if (item.is_honeypot === true || item.is_honeypot === 1) failures.push('GMGN honeypot flag triggered');

    const volumeScore = clamp(Math.log10(Math.max(volumeUsd, 1)) / 7, 0, 1);
    const smartScore = clamp(smartMoney / 5, 0, 1);
    const renownedScore = clamp(renowned / 5, 0, 1);
    // GMGN explicitly says hot_level is not normalized; use within-result rank instead.
    const listRankScore = finite(rankPosition)
      ? 1 - clamp((rankPosition - 1) / Math.max(items.length - 1, 1), 0, 1)
      : 1 - itemIndex / Math.max(items.length - 1, 1);
    const momentumScore = clamp((priceChangePct + 20) / 80, 0, 1);
    const safetyScore = clamp(
      1 - (Math.max(0, rugRatio) / Math.max(maxRugRatio, 0.001)) * 0.35 -
      (Math.max(0, top10) / Math.max(maxTop10HolderRate, 0.001)) * 0.25 -
      (Math.max(0, insider) / Math.max(maxInsiderRate, 0.001)) * 0.2 -
      (Math.max(0, bundler) / Math.max(maxBundlerRate, 0.001)) * 0.2, 0, 1
    );
    const score = Math.round(100 * (
      0.25 * volumeScore +
      0.20 * smartScore +
      0.10 * renownedScore +
      0.10 * listRankScore +
      0.10 * momentumScore +
      0.25 * safetyScore
    ));
    const stage = smartMoney >= 3 && priceChangePct > 20
      ? 'breakout-watch'
      : (smartMoney === 0 && tokenAgeDays < 1 ? 'early-high-risk' : 'research');

    return {
      address,
      chain,
      symbol: item.symbol ?? null,
      name: item.name ?? null,
      exchange: item.exchange ?? null,
      launchpadPlatform: item.launchpad_platform ?? null,
      rank: finite(item.rank) ? Number(item.rank) : null,
      marketCapUsd: finite(item.market_cap) ? marketCapUsd : null,
      liquidityUsd: finite(item.liquidity) ? liquidityUsd : null,
      volumeUsd: finite(item.volume) ? volumeUsd : null,
      swaps: finite(item.swaps) ? swaps : null,
      buys: finite(item.buys) ? buys : null,
      sells: finite(item.sells) ? sells : null,
      tokenAgeDays: finite(tokenAgeDays) ? tokenAgeDays : null,
      smartDegenCount: finite(smartMoney) ? smartMoney : null,
      renownedCount: finite(renowned) ? renowned : null,
      hotLevel: finite(hotLevel) ? hotLevel : null,
      rugRatio: finite(rugRatio) ? rugRatio : null,
      washTrading,
      top10HolderRate: finite(top10) ? top10 : null,
      insiderRate: finite(insider) ? insider : null,
      bundlerRate: finite(bundler) ? bundler : null,
      priceChangePercent: finite(priceChangePct) ? priceChangePct : null,
      sellBuyRatio: buys > 0 ? sells / buys : null,
      score,
      stage,
      eligibleForMeteoraPoolLookup: failures.length === 0,
      failures,
      source: 'gmgn-trending-discovery',
      note: 'Discovery only. Resolve exact Meteora pool and apply independent pair/token/position fee and inventory-risk checks.'
    };
  }).sort((a, b) =>
    Number(b.eligibleForMeteoraPoolLookup) - Number(a.eligibleForMeteoraPoolLookup) ||
    b.score - a.score
  ).slice(0, limit);
}
