const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

/**
 * Rank wallet-performance records supplied by a trusted wallet intelligence
 * provider or manually curated feed. This module does not discover identities
 * or assert that an arbitrary wallet is a "top trader".
 */
export function rankTopLpWallets(records, {
  now = Date.now(),
  maxDataAgeSec = 3600,
  minClosedPositions = 20,
  minWinRatePct = 50,
  minRealizedPnlUsd = 0,
  minScore = 65,
  limit = 100
} = {}) {
  if (!Array.isArray(records)) throw new Error('wallet records must be an array');
  return records.map(record => {
    const address = String(record.address ?? record.walletAddress ?? '').trim();
    const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : Date.parse(record.updatedAt);
    const ageSec = (now - updatedAt) / 1000;
    const closed = Number(record.closedPositions);
    const winRate = Number(record.winRatePct);
    const realized = Number(record.realizedPnlUsd);
    const fees = Number(record.feesEarnedUsd);
    const drawdown = Number(record.maxDrawdownPct);
    const rangeEfficiency = Number(record.rangeEfficiencyPct ?? 0);
    const verified = record.verified === true && record.source === 'top-lp-wallet-index';
    const complete = Boolean(address) &&
      [updatedAt, closed, winRate, realized, fees, drawdown, rangeEfficiency].every(Number.isFinite);
    const failures = [];
    if (!verified) failures.push('wallet performance source is not verified');
    if (!complete) failures.push('wallet performance fields missing');
    if (ageSec < 0 || ageSec > maxDataAgeSec) failures.push('wallet performance data stale');
    if (closed < minClosedPositions) failures.push('insufficient closed LP positions');
    if (winRate < minWinRatePct) failures.push('wallet win rate below floor');
    if (realized <= minRealizedPnlUsd) failures.push('wallet realized PnL is not positive');
    if (drawdown < 0 || drawdown > 50) failures.push('wallet drawdown outside allowed range');

    // Bounded, transparent ranking: realised PnL, win rate, fee production,
    // range efficiency and drawdown each contribute; raw wallet size does not.
    const pnlScore = finite(realized) ? Math.max(0, Math.min(100, 50 + 50 * Math.tanh(realized / Math.max(100, Math.abs(fees) + 1)))) : 0;
    const winScore = finite(winRate) ? Math.max(0, Math.min(100, winRate)) : 0;
    const feeScore = finite(fees) ? Math.max(0, Math.min(100, 50 + 10 * Math.log10(Math.max(0, fees) + 1))) : 0;
    const rangeScore = finite(rangeEfficiency) ? Math.max(0, Math.min(100, rangeEfficiency)) : 0;
    const drawdownScore = finite(drawdown) ? Math.max(0, 100 - drawdown * 2) : 0;
    const score = Math.round(pnlScore * 0.30 + winScore * 0.25 + feeScore * 0.15 + rangeScore * 0.15 + drawdownScore * 0.15);
    if (score < minScore) failures.push('wallet rank score below floor');
    return {
      address,
      score,
      eligible: failures.length === 0,
      failures,
      metrics: {
        closedPositions: Number.isFinite(closed) ? closed : null,
        winRatePct: Number.isFinite(winRate) ? winRate : null,
        realizedPnlUsd: Number.isFinite(realized) ? realized : null,
        feesEarnedUsd: Number.isFinite(fees) ? fees : null,
        maxDrawdownPct: Number.isFinite(drawdown) ? drawdown : null,
        rangeEfficiencyPct: Number.isFinite(rangeEfficiency) ? rangeEfficiency : null,
        ageSec: Number.isFinite(ageSec) ? ageSec : null
      },
      source: 'top-lp-wallet-index'
    };
  }).filter(x => x.eligible).sort((a,b)=>b.score-a.score).slice(0, Math.max(1, Number(limit) || 100));
}

/** Attach a trusted rank record to one verified Meteora wallet event. */
export function enrichWalletEvent(event, rankedWallets = []) {
  const wallet = String(event?.walletAddress ?? event?.wallet ?? '').trim();
  const ranked = rankedWallets.find(x => x.eligible && x.address === wallet);
  if (!ranked) return { ...event, walletRankVerified: false, walletRankScore: 0 };
  return {
    ...event,
    walletAddress: wallet,
    walletRankVerified: true,
    walletRankSource: 'top-lp-wallet-index',
    walletRankScore: ranked.score
  };
}

/** Build compact 24h LP activity metrics from already verified wallet events. */
export function summarizeWalletActivity(events, { now = Date.now(), maxAgeSec = 120 } = {}) {
  if (!Array.isArray(events)) throw new Error('wallet events must be an array');
  const recent = events.filter(event => {
    const at = typeof event.timestamp === 'number' ? event.timestamp : Date.parse(event.timestamp);
    return event.verified === true && event.success === true &&
      event.programId === 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo' &&
      Number.isFinite(at) && at <= now && now - at <= maxAgeSec * 1000 &&
      event.walletRankVerified === true && event.walletRankSource === 'top-lp-wallet-index';
  });
  const unique = new Map();
  for (const event of recent) {
    const key = String(event.walletGroup ?? event.walletAddress ?? '');
    if (key && !unique.has(key)) unique.set(key, event);
  }
  const adds = recent.filter(e => e.eventType === 'add-liquidity');
  const removes = recent.filter(e => e.eventType === 'remove-liquidity');
  const addUsd = adds.reduce((sum,e)=>sum+(Number(e.quoteAmountUsd)||0),0);
  const removeUsd = removes.reduce((sum,e)=>sum+(Number(e.quoteAmountUsd)||0),0);
  const ranked = [...unique.values()].map(e=>Number(e.walletRankScore)).filter(Number.isFinite);
  const averageWalletRankScore = ranked.length ? ranked.reduce((a,b)=>a+b,0)/ranked.length : 0;
  return {
    verified: recent.length > 0,
    source: 'helius-wallet-monitor',
    dataAgeSec: recent.length ? Math.max(0,(now-Math.max(...recent.map(e=>typeof e.timestamp==='number'?e.timestamp:Date.parse(e.timestamp))))/1000) : null,
    uniqueActiveWallets24h: unique.size,
    addEvents: adds.length,
    removeEvents: removes.length,
    quoteAddsUsd: addUsd,
    quoteRemovesUsd: removeUsd,
    netQuoteFlowUsd: addUsd - removeUsd,
    averageWalletRankScore,
    walletActivityScore: Math.round(Math.min(100, averageWalletRankScore * 0.7 + Math.min(30, unique.size * 5)))
  };
}
