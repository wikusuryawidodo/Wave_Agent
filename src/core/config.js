const solPriceUsd = Number(process.env.SOL_PRICE_USD ?? 0);
const startingEquitySol = Number(process.env.STARTING_EQUITY_SOL ?? 3);
const explicitPaperEquity = process.env.PAPER_STARTING_EQUITY_USD;
const startingEquityUsd = explicitPaperEquity != null && explicitPaperEquity !== ''
  ? Number(explicitPaperEquity)
  : (solPriceUsd > 0 ? startingEquitySol * solPriceUsd : 0);

export const config = Object.freeze({
  mode: 'paper',
  strategy: Object.freeze({ entry: 'hybrid', style: 'balanced-lp', exit: 'dynamic-lp' }),
  startingEquitySol,
  startingEquityUsd,
  maxRiskPerPositionPct: Number(process.env.MAX_RISK_PER_POSITION_PCT ?? 0.003),
  maxPortfolioRiskPct: Number(process.env.MAX_PORTFOLIO_RISK_PCT ?? 0.006),
  maxPositionAllocationPct: Number(process.env.MAX_POSITION_ALLOCATION_PCT ?? 0.125),
  maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS ?? 2),
  minTvlUsd: Number(process.env.MIN_TVL_USD ?? 25_000),
  minVolume24hUsd: Number(process.env.MIN_VOLUME_24H_USD ?? 10_000),
  maxPoolDataAgeSec: Number(process.env.MAX_POOL_DATA_AGE_SEC ?? 90),
  maxSecurityDataAgeSec: Number(process.env.MAX_SECURITY_DATA_AGE_SEC ?? 300),
  minFeeApr7dPct: Number(process.env.MIN_FEE_APR_7D_PCT ?? 40),
  minFeeApr24hPct: Number(process.env.MIN_FEE_APR_24H_PCT ?? 35),
  minExpectedNetEdgePct: Number(process.env.MIN_EXPECTED_NET_EDGE_PCT ?? 0.10),
  feeCaptureShare: Number(process.env.FEE_CAPTURE_SHARE ?? 0.65),
  expectedHoldHours: Number(process.env.EXPECTED_HOLD_HOURS ?? 168),
  roundTripCostBps: Number(process.env.ROUND_TRIP_COST_BPS ?? 30),
  maxVolatility24hPct: Number(process.env.MAX_VOLATILITY_24H_PCT ?? 7),
  maxStressLossPct: Number(process.env.MAX_STRESS_LOSS_PCT ?? 8),
  maxDailyLossPct: Number(process.env.MAX_DAILY_LOSS_PCT ?? 1.5),
  maxDrawdownPct: Number(process.env.MAX_DRAWDOWN_PCT ?? 5),
  paperOnly: true
});

if (!Number.isFinite(startingEquitySol) || startingEquitySol <= 0) {
  throw new Error('STARTING_EQUITY_SOL must be positive');
}
if (!Number.isFinite(startingEquityUsd) || startingEquityUsd < 0) {
  throw new Error('PAPER_STARTING_EQUITY_USD or SOL_PRICE_USD is invalid');
}
if (!(config.maxRiskPerPositionPct > 0 && config.maxRiskPerPositionPct <= 0.003)) {
  throw new Error('MAX_RISK_PER_POSITION_PCT must be >0 and <=0.3%');
}
if (!(config.maxPortfolioRiskPct >= config.maxRiskPerPositionPct && config.maxPortfolioRiskPct <= 0.006)) {
  throw new Error('MAX_PORTFOLIO_RISK_PCT must be >= per-position risk and <=0.6%');
}
if (!(config.maxPositionAllocationPct > 0 && config.maxPositionAllocationPct <= 0.125)) {
  throw new Error('MAX_POSITION_ALLOCATION_PCT must be >0 and <=12.5%');
}
if (!Number.isInteger(config.maxOpenPositions) || config.maxOpenPositions < 1 || config.maxOpenPositions > 2) {
  throw new Error('MAX_OPEN_POSITIONS must be 1 or 2');
}
