const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

export const ASYMMETRIC_REBALANCE_LEVELS_PCT = Object.freeze([15, 30, 45]);

/**
 * Paper-only asymmetric management:
 * - trigger a range rebalance at -15/-30/-45% spot drawdown from entry;
 * - hard-stop at -50%;
 * - reuse existing inventory/capital only; never average down with new capital.
 *
 * A valid, fresh read-only composition quote is required before the engine changes
 * its paper range. This function never creates or submits a transaction.
 */
export function evaluateAsymmetricRebalance({
  position,
  currentPrice,
  quote = null,
  now = Date.now(),
  hardStopLossPct = 50,
  rebalanceLevelsPct = ASYMMETRIC_REBALANCE_LEVELS_PCT,
  maxQuoteAgeSec = 30,
  maxPriceImpactBps = 50,
  maxResidualBalancePct = 5
} = {}) {
  if (!position || !finite(position.entryPrice) || Number(position.entryPrice) <= 0 ||
      !finite(currentPrice) || Number(currentPrice) <= 0) {
    return { status: 'blocked', reason: 'entry and current prices are required' };
  }
  const drawdownPct = (Number(currentPrice) / Number(position.entryPrice) - 1) * 100;
  if (drawdownPct <= -Math.abs(Number(hardStopLossPct))) {
    return { status: 'hard-stop', reason: 'asymmetric-hard-stop', drawdownPct, hardStopLossPct: -Math.abs(Number(hardStopLossPct)) };
  }

  const completed = new Set(position.rebalanceLevelsCompleted ?? []);
  const levels = [...rebalanceLevelsPct].map(Number).filter(x => Number.isFinite(x) && x > 0).sort((a,b)=>a-b);
  const level = levels.find(x => drawdownPct <= -x && !completed.has(x));
  if (level == null) return { status: 'hold', drawdownPct };

  const quoteTimestamp = typeof quote?.timestamp === 'number' ? quote.timestamp : Date.parse(quote?.timestamp);
  const range = quote?.range ?? {};
  const quoteValid =
    quote?.verified === true &&
    quote?.source === 'read-only-router-quote' &&
    quote?.poolAddress === position.poolAddress &&
    Number.isFinite(quoteTimestamp) &&
    quoteTimestamp <= now + 5_000 &&
    now - quoteTimestamp <= maxQuoteAgeSec * 1000 &&
    finite(quote.priceImpactBps) &&
    Number(quote.priceImpactBps) >= 0 &&
    Number(quote.priceImpactBps) <= maxPriceImpactBps &&
    finite(quote.residualBalancePct) &&
    Number(quote.residualBalancePct) >= 0 &&
    Number(quote.residualBalancePct) <= maxResidualBalancePct &&
    finite(range.lower) && finite(range.upper) &&
    Number(range.lower) > 0 && Number(range.upper) > Number(range.lower) &&
    Number(range.lower) < Number(currentPrice) &&
    Number(range.upper) > Number(currentPrice) &&
    (quote.fundingMode ?? 'reuse-existing-inventory') === 'reuse-existing-inventory' &&
    (!finite(quote.additionalCapitalUsd) || Number(quote.additionalCapitalUsd) === 0);

  if (!quoteValid) {
    return {
      status: 'quote-required',
      levelPct: level,
      drawdownPct,
      reason: 'fresh verified read-only composition quote required; new capital top-ups are disabled'
    };
  }

  return {
    status: 'rebalance-ready',
    mode: 'paper-only',
    levelPct: level,
    drawdownPct,
    poolAddress: position.poolAddress,
    previousRange: structuredClone(position.range),
    nextRange: { lower: Number(range.lower), upper: Number(range.upper) },
    quoteTimestamp,
    priceImpactBps: Number(quote.priceImpactBps),
    residualBalancePct: Number(quote.residualBalancePct),
    additionalCapitalUsd: 0,
    reason: 'recenter LP range using existing position inventory'
  };
}
