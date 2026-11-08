export const config = Object.freeze({
  mode: 'paper',
  chains: ['solana', 'base', 'bsc', 'robinhood'],
  startingEquitySol: Number(process.env.STARTING_EQUITY_SOL ?? 3),
  maxRiskPerPositionPct: Number(process.env.MAX_RISK_PER_POSITION_PCT ?? 0.005),
  maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS ?? 2),
  minTvlUsd: Number(process.env.MIN_TVL_USD ?? 25_000),
  minVolume24hUsd: Number(process.env.MIN_VOLUME_24H_USD ?? 10_000),
  maxVolumeToTvl: 8,
  maxPoolAgeDays: 3650,
  paperOnly: true,
});

if (!Number.isFinite(config.startingEquitySol) || config.startingEquitySol <= 0) {
  throw new Error('STARTING_EQUITY_SOL must be a positive number');
}
if (config.maxRiskPerPositionPct <= 0 || config.maxRiskPerPositionPct > 0.01) {
  throw new Error('Risk per position must be >0 and <=1% for this balanced preset');
}
