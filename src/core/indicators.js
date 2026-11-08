const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

function emaSeries(values, period) {
  if (values.length < period) return Array(values.length).fill(null);
  const result = Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let current = mean(values.slice(0, period));
  result[period - 1] = current;
  for (let i = period; i < values.length; i++) {
    current = values[i] * alpha + current * (1 - alpha);
    result[i] = current;
  }
  return result;
}

function wilderSeries(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  let current = mean(values.slice(0, period));
  result[period - 1] = current;
  for (let i = period; i < values.length; i++) {
    current = (current * (period - 1) + values[i]) / period;
    result[i] = current;
  }
  return result;
}

function supertrendDirection(high, low, close, atr, period, multiplier = 3) {
  const upper = Array(close.length).fill(null);
  const lower = Array(close.length).fill(null);
  const direction = Array(close.length).fill(null);
  const value = Array(close.length).fill(null);
  const first = period - 1;
  if (atr[first] == null) return { direction: 'unknown', value: null };

  for (let i = first; i < close.length; i++) {
    const midpoint = (high[i] + low[i]) / 2;
    const basicUpper = midpoint + multiplier * atr[i];
    const basicLower = midpoint - multiplier * atr[i];
    if (i === first) {
      upper[i] = basicUpper;
      lower[i] = basicLower;
      direction[i] = close[i] >= midpoint ? 'bullish' : 'bearish';
    } else {
      upper[i] = basicUpper < upper[i - 1] || close[i - 1] > upper[i - 1]
        ? basicUpper : upper[i - 1];
      lower[i] = basicLower > lower[i - 1] || close[i - 1] < lower[i - 1]
        ? basicLower : lower[i - 1];
      direction[i] = direction[i - 1] === 'bullish'
        ? (close[i] < lower[i] ? 'bearish' : 'bullish')
        : (close[i] > upper[i] ? 'bullish' : 'bearish');
    }
    value[i] = direction[i] === 'bullish' ? lower[i] : upper[i];
  }
  return { direction: direction.at(-1) ?? 'unknown', value: value.at(-1) };
}

export function calculateIndicators(candles, {
  atrPeriod = 14,
  rsiPeriod = 14,
  supertrendMultiplier = 3,
  bollingerPeriod = 20,
  adxPeriod = 14
} = {}) {
  if (!Array.isArray(candles) || candles.length < 60) {
    throw new Error('At least 60 completed candles are required');
  }
  const open = candles.map(c => Number(c.open));
  const high = candles.map(c => Number(c.high));
  const low = candles.map(c => Number(c.low));
  const close = candles.map(c => Number(c.close));
  const volume = candles.map(c => Number(c.volume));

  for (let i = 0; i < candles.length; i++) {
    if (![open[i], high[i], low[i], close[i], volume[i]].every(Number.isFinite) ||
        open[i] <= 0 || high[i] <= 0 || low[i] <= 0 || close[i] <= 0 || volume[i] < 0 ||
        high[i] < Math.max(open[i], close[i], low[i]) ||
        low[i] > Math.min(open[i], close[i], high[i])) {
      throw new Error(`Invalid OHLCV candle at index ${i}`);
    }
    if (candles[i].timestamp != null && i > 0 &&
        Number(candles[i].timestamp) <= Number(candles[i - 1].timestamp)) {
      throw new Error('Candle timestamps must be strictly increasing');
    }
  }

  const trueRanges = [];
  const plusDm = [];
  const minusDm = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trueRanges.push(high[i] - low[i]);
      plusDm.push(0);
      minusDm.push(0);
      continue;
    }
    trueRanges.push(Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    ));
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const atr = wilderSeries(trueRanges, atrPeriod);
  const gains = [];
  const losses = [];
  for (let i = 1; i < close.length; i++) {
    const delta = close[i] - close[i - 1];
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }
  const avgGain = wilderSeries(gains, rsiPeriod);
  const avgLoss = wilderSeries(losses, rsiPeriod);
  const lastGain = avgGain.at(-1);
  const lastLoss = avgLoss.at(-1);
  const rsi = lastLoss === 0 ? 100 : 100 - 100 / (1 + lastGain / lastLoss);

  const plusSmooth = wilderSeries(plusDm.slice(1), adxPeriod);
  const minusSmooth = wilderSeries(minusDm.slice(1), adxPeriod);
  const dx = Array(close.length - 1).fill(null);
  for (let i = 0; i < dx.length; i++) {
    const a = plusSmooth[i], b = minusSmooth[i], tr = atr[i + 1];
    if (a == null || b == null || !(tr > 0)) continue;
    const plusDi = 100 * a / tr;
    const minusDi = 100 * b / tr;
    dx[i] = 100 * Math.abs(plusDi - minusDi) / Math.max(plusDi + minusDi, 1e-12);
  }
  const validDx = dx.map((v, i) => ({ v, i })).filter(x => x.v != null);
  const adxValues = wilderSeries(validDx.map(x => x.v), adxPeriod);
  const adx = adxValues.at(-1) ?? 0;

  const ema12 = emaSeries(close, 12);
  const ema26 = emaSeries(close, 26);
  const macdLine = close.map((_, i) => ema12[i] == null || ema26[i] == null ? null : ema12[i] - ema26[i]);
  const firstMacdIndex = macdLine.findIndex(v => v != null);
  const validMacd = macdLine.slice(firstMacdIndex);
  const signal = emaSeries(validMacd, 9);
  const macd = macdLine.at(-1);
  const macdSignal = signal.at(-1);
  const bbWindow = close.slice(-bollingerPeriod);
  const bbMid = mean(bbWindow);
  const bbStd = Math.sqrt(mean(bbWindow.map(value => (value - bbMid) ** 2)));
  const volumeBase = mean(volume.slice(-21, -1));
  const volumeRatio = volumeBase > 0 ? volume.at(-1) / volumeBase : 0;
  const st = supertrendDirection(high, low, close, atr, atrPeriod, supertrendMultiplier);
  const currentAtr = atr.at(-1);

  return {
    price: close.at(-1),
    atr: currentAtr,
    atrPct: currentAtr / close.at(-1) * 100,
    rsi,
    adx,
    ema50: emaSeries(close, 50).at(-1),
    bb: { mid: bbMid, upper: bbMid + 2 * bbStd, lower: bbMid - 2 * bbStd },
    macd,
    macdSignal,
    macdBias: macd > macdSignal ? 'bullish' : 'bearish',
    volumeRatio,
    supertrend: st.direction,
    supertrendValue: st.value,
    note: 'RSI and ATR use Wilder smoothing; Supertrend uses recursively updated bands. Confirm against a trusted chart/data source before relying on production signals.'
  };
}
