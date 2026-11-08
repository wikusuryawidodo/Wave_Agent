import { calculateIndicators } from './indicators.js';
import { normalizePoolMetrics } from './normalizer.js';

export function scorePool(inputPool, candles, cfg) {
  const hardFails = [];
  let pool;
  try { pool = normalizePoolMetrics(inputPool); }
  catch (e) { return { eligible:false, score:0, hardFails:[e.message], indicators:null }; }
  if (!pool.poolAddress || !pool.chain) hardFails.push('missing pool identity');
  if (pool.tvlUsd < cfg.minTvlUsd) hardFails.push('TVL below minimum');
  if (pool.volume24hUsd < cfg.minVolume24hUsd) hardFails.push('24h volume below minimum');
  if (pool.volumeToTvl > cfg.maxVolumeToTvl) hardFails.push('volume/TVL anomaly');
  if (pool.liquidityTrend24hPct != null && pool.liquidityTrend24hPct < -15) hardFails.push('liquidity outflow >15%');
  if (pool.dataAgeSec != null && pool.dataAgeSec > 90) hardFails.push('stale pool data');
  if (pool.audit?.critical === true) hardFails.push('critical token/pool safety finding');
  if (hardFails.length) return { eligible:false, score:0, hardFails, indicators:null };

  let ind;
  try { ind = calculateIndicators(candles); }
  catch (e) { return { eligible:false, score:0, hardFails:[`candle data: ${e.message}`], indicators:null }; }
  let score=0;
  if (ind.supertrend === 'bullish') score+=15;
  if (ind.macdBias === 'bullish') score+=10;
  if (ind.rsi >= 45 && ind.rsi <= 68) score+=10;
  if (ind.price >= ind.bb.mid) score+=10;
  if (ind.volumeRatio >= 1.3 && ind.volumeRatio <= 5) score+=10;
  if (pool.observedFeeAprPct >= 20) score+=15;
  else if (pool.observedFeeAprPct >= 10) score+=8;
  if (pool.tvlUsd >= cfg.minTvlUsd*2) score+=10;
  if ((pool.liquidityTrend24hPct ?? 0)>=0) score+=10;
  if (pool.feeVolumeConsistency==='high') score+=10;
  return { eligible:score>=65, score, hardFails:[], indicators:ind,
    feeAprObservedPct:pool.observedFeeAprPct,
    decision:score>=80?'strong-watch':score>=65?'watch':'skip',
    warning:'Ranking heuristic only; not a probability or guaranteed return.' };
}
