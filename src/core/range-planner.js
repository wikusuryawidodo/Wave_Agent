export function planRange({ price, atr, volatilityPct, trend }) {
  if (!(price > 0 && atr > 0)) throw new Error('price and ATR must be positive');
  const vol = Math.max(0.01, Math.min(Number(volatilityPct ?? (atr/price*100)), 25));
  // Wider ranges in volatile markets; asymmetric modest trend bias.
  const halfWidthPct = Math.max(2, Math.min(12, vol * 2.2));
  const bias = trend === 'bullish' ? 1.1 : trend === 'bearish' ? 0.9 : 1;
  const lower = price * (1 - halfWidthPct/100 * bias);
  const upper = price * (1 + halfWidthPct/100 / bias);
  return { lower, upper, halfWidthPct, strategy: 'balanced-volatility-range',
    rebalanceAt: { lower: lower + (upper-lower)*0.1, upper: upper - (upper-lower)*0.1 } };
}
