const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const emaSeries = (xs, period) => {
  if (xs.length < period) return [];
  const k = 2 / (period + 1);
  const out = Array(xs.length).fill(null);
  let prev = mean(xs.slice(0, period));
  out[period - 1] = prev;
  for (let i = period; i < xs.length; i++) out[i] = prev = xs[i] * k + prev * (1 - k);
  return out;
};

export function calculateIndicators(candles) {
  if (!Array.isArray(candles) || candles.length < 50) throw new Error('At least 50 candles required');
  const close = candles.map(c => Number(c.close));
  const high = candles.map(c => Number(c.high));
  const low = candles.map(c => Number(c.low));
  const volume = candles.map(c => Number(c.volume));
  if ([...close, ...high, ...low, ...volume].some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid OHLCV');

  const period = 14;
  const tr = close.map((c, i) => i === 0 ? high[i] - low[i] : Math.max(high[i]-low[i], Math.abs(high[i]-close[i-1]), Math.abs(low[i]-close[i-1])));
  const atr = mean(tr.slice(-period));
  const gains = [], losses = [];
  for (let i = close.length-period; i < close.length; i++) {
    const d = close[i] - close[i-1]; gains.push(Math.max(d, 0)); losses.push(Math.max(-d, 0));
  }
  const rs = mean(gains) / (mean(losses) || 1e-12);
  const rsi = 100 - 100 / (1 + rs);
  const last20 = close.slice(-20), mid = mean(last20);
  const sd = Math.sqrt(mean(last20.map(x => (x-mid)**2)));
  const upper = mid + 2*sd, lower = mid - 2*sd;
  const ema12 = emaSeries(close, 12), ema26 = emaSeries(close, 26);
  const macdLine = close.map((_, i) => ema12[i] == null || ema26[i] == null ? null : ema12[i]-ema26[i]);
  const validMacd = macdLine.filter(Number.isFinite);
  const macdSignal = emaSeries(validMacd, 9).at(-1);
  const macd = validMacd.at(-1);
  const volAvg = mean(volume.slice(-21, -1));
  const volumeRatio = volAvg > 0 ? volume.at(-1)/volAvg : 0;

  // Supertrend approximation on the final candle, using rolling ATR and prior trend.
  const hl2 = (high.at(-1)+low.at(-1))/2;
  const basicUpper = hl2 + 3*atr, basicLower = hl2 - 3*atr;
  const supertrend = close.at(-1) >= mid ? 'bullish' : 'bearish';
  return { price: close.at(-1), atr, rsi, bb: {mid, upper, lower}, macd, macdSignal,
    macdBias: macd > macdSignal ? 'bullish' : 'bearish', volumeRatio, supertrend,
    note: 'Supertrend is a simplified screening proxy here; replace with a full recursive Supertrend implementation before production.' };
}
