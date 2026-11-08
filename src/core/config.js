const solPriceUsd = Number(process.env.SOL_PRICE_USD ?? 0);
const startingEquitySol = Number(process.env.STARTING_EQUITY_SOL ?? 3);
const explicitPaperEquity = process.env.PAPER_STARTING_EQUITY_USD;
const startingEquityUsd = explicitPaperEquity != null && explicitPaperEquity !== ''
  ? Number(explicitPaperEquity)
  : (solPriceUsd > 0 ? startingEquitySol * solPriceUsd : 0);

export const config = Object.freeze({
  mode: 'paper',
  strategy: Object.freeze({ entry: 'hybrid', style: 'balanced', exit: 'dynamic' }),
  chains: ['solana', 'base', 'bsc', 'robinhood'],
  startingEquitySol,
  startingEquityUsd,
  solPriceUsd,
  maxRiskPerPositionPct: Number(process.env.MAX_RISK_PER_POSITION_PCT ?? 0.005),
  maxPortfolioRiskPct: Number(process.env.MAX_PORTFOLIO_RISK_PCT ?? 0.01),
  maxPositionAllocationPct: Number(process.env.MAX_POSITION_ALLOCATION_PCT ?? 0.25),
  maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS ?? 2),
  minTvlUsd: Number(process.env.MIN_TVL_USD ?? 25_000),
  minVolume24hUsd: Number(process.env.MIN_VOLUME_24H_USD ?? 10_000),
  maxVolumeToTvl: 8,
  maxPoolDataAgeSec: Number(process.env.MAX_POOL_DATA_AGE_SEC ?? 90),
  maxDailyLossPct: Number(process.env.MAX_DAILY_LOSS_PCT ?? 2),
  maxDrawdownPct: Number(process.env.MAX_DRAWDOWN_PCT ?? 8),
  paperOnly: true,
});

if (!Number.isFinite(startingEquitySol) || startingEquitySol <= 0) {
  throw new Error('STARTING_EQUITY_SOL must be a positive number');
}
if (!Number.isFinite(startingEquityUsd) || startingEquityUsd < 0) {
  throw new Error('PAPER_STARTING_EQUITY_USD or SOL_PRICE_USD is invalid');
}
for (const [name, value] of [
  ['MAX_RISK_PER_POSITION_PCT', config.maxRiskPerPositionPct],
  ['MAX_PORTFOLIO_RISK_PCT', config.maxPortfolioRiskPct],
  ['MAX_POSITION_ALLOCATION_PCT', config.maxPositionAllocationPct],
]) {
  if (!(value > 0 && value <= 0.25)) throw new Error(`${name} must be >0 and <=25%`);
}
if (config.maxRiskPerPositionPct > 0.01 || config.maxPortfolioRiskPct > 0.02) {
  throw new Error('Risk caps exceed hard safety bounds');
}
if (config.maxPortfolioRiskPct < config.maxRiskPerPositionPct) {
  throw new Error('MAX_PORTFOLIO_RISK_PCT cannot be below per-position risk');
}
if (!Number.isInteger(config.maxOpenPositions) || config.maxOpenPositions < 1 || config.maxOpenPositions > 2) {
  throw new Error('MAX_OPEN_POSITIONS must be 1 or 2 in the balanced preset');
}
