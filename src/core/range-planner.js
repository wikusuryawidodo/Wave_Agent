const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Compatibility planner retained for the existing tests and generic analytics. */
export function planRange({ price, atr, volatilityPct, trend }) {
  if (!(price > 0 && atr > 0)) throw new Error('price and ATR must be positive');
  const vol = clamp(Number(volatilityPct ?? (atr / price * 100)), 0.01, 25);
  const halfWidthPct = clamp(vol * 2.2, 2, 12);
  const bias = trend === 'bullish' ? 1.1 : trend === 'bearish' ? 0.9 : 1;
  const lower = price * (1 - halfWidthPct / 100 * bias);
  const upper = price * (1 + halfWidthPct / 100 / bias);
  return {
    lower, upper, halfWidthPct,
    strategy: 'balanced-volatility-range',
    rebalanceAt: { lower: lower + (upper - lower) * 0.1, upper: upper - (upper - lower) * 0.1 }
  };
}

/**
 * LP-first symmetric range planner. Width is driven by realised volatility and ATR;
 * trend is used as a risk gate, not to skew the inventory distribution.
 */
export function planLpRange({ price, atr, volatility24hPct, minHalfWidthPct = 2, maxHalfWidthPct = 6 }) {
  if (!(Number.isFinite(price) && price > 0 && Number.isFinite(atr) && atr > 0)) {
    throw new Error('price and ATR must be positive');
  }
  if (!(Number.isFinite(volatility24hPct) && volatility24hPct >= 0)) {
    throw new Error('volatility24hPct must be non-negative');
  }
  const atrPct = atr / price * 100;
  const halfWidthPct = clamp(Math.max(atrPct * 2.2, volatility24hPct * 0.75), minHalfWidthPct, maxHalfWidthPct);
  const lower = price * (1 - halfWidthPct / 100);
  const upper = price * (1 + halfWidthPct / 100);
  return {
    lower,
    upper,
    halfWidthPct,
    atrPct,
    strategy: 'lp-volatility-balanced',
    rebalanceBand: {
      lower: lower + (upper - lower) * 0.1,
      upper: upper - (upper - lower) * 0.1
    },
    note: 'Paper range only. Validate bin depth and inventory distribution before a live LP decision.'
  };
}
