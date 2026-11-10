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
  maxPositionAllocationPct: Number(process.env.MAX_POSITION_ALLOCATION_PCT ?? 0.45),
  maxPortfolioUtilizationPct: Number(process.env.MAX_PORTFOLIO_UTILIZATION_PCT ?? 0.90),
  hardStopLossPct: Number(process.env.HARD_STOP_LOSS_PCT ?? 50),
  rebalanceLevelsPct: Object.freeze([15, 30, 45]),
  rebalanceQuoteMaxAgeSec: Number(process.env.REBALANCE_QUOTE_MAX_AGE_SEC ?? 30),
  minWalletRankScore: Number(process.env.MIN_WALLET_RANK_SCORE ?? 65),
  requireRankedWallets: process.env.REQUIRE_RANKED_LP_WALLETS !== 'false',
  maxTvlUsd: Number(process.env.MAX_TVL_USD ?? 150_000),
  maxMarketCapUsd: Number(process.env.MAX_MARKET_CAP_USD ?? 10_000_000),
  minOrganicScore: Number(process.env.MIN_ORGANIC_SCORE ?? 60),
  minQuoteOrganicScore: Number(process.env.MIN_QUOTE_ORGANIC_SCORE ?? 60),
  maxBotHoldersPct: Number(process.env.MAX_BOT_HOLDERS_PCT ?? 30),
  minTokenFeesSol: Number(process.env.MIN_TOKEN_FEES_SOL ?? 30),
  minBinStep: Number(process.env.MIN_BIN_STEP ?? 80),
  maxBinStep: Number(process.env.MAX_BIN_STEP ?? 125),
  minFeeActiveTvlRatio: Number(process.env.MIN_FEE_ACTIVE_TVL_RATIO ?? 0.05),
  maxVolatility24hPct: Number(process.env.MAX_VOLATILITY_24H_PCT ?? 7),
  allowedLaunchpads: Object.freeze((process.env.ALLOWED_LAUNCHPADS ?? '').split(',').map(x => x.trim()).filter(Boolean)),
  blockedLaunchpads: Object.freeze((process.env.BLOCKED_LAUNCHPADS ?? '').split(',').map(x => x.trim()).filter(Boolean)),
  maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS ?? 2),
  minTvlUsd: Number(process.env.MIN_TVL_USD ?? 25_000),
  minVolume24hUsd: Number(process.env.MIN_VOLUME_24H_USD ?? 10_000),
  maxPoolDataAgeSec: Number(process.env.MAX_POOL_DATA_AGE_SEC ?? 90),
  maxSecurityDataAgeSec: Number(process.env.MAX_SECURITY_DATA_AGE_SEC ?? 300),
  minPairAgeDays: Number(process.env.MIN_PAIR_AGE_DAYS ?? 14),
  maxPairEvidenceAgeSec: Number(process.env.MAX_PAIR_EVIDENCE_AGE_SEC ?? 120),
  minMarketCapUsd: Number(process.env.MIN_MARKET_CAP_USD ?? 250_000),
  maxFdvToMarketCap: Number(process.env.MAX_FDV_TO_MARKET_CAP ?? 2.5),
  minPairLiquidityUsd: Number(process.env.MIN_PAIR_LIQUIDITY_USD ?? 50_000),
  minLiquidityToMarketCap: Number(process.env.MIN_LIQUIDITY_TO_MARKET_CAP ?? 0.08),
  minTransactions24h: Number(process.env.MIN_TRANSACTIONS_24H ?? 50),
  minSells24h: Number(process.env.MIN_SELLS_24H ?? 15),
  minSellBuyRatio: Number(process.env.MIN_SELL_BUY_RATIO ?? 0.35),
  maxSellBuyRatio: Number(process.env.MAX_SELL_BUY_RATIO ?? 3.5),
  minPairPriceChange24hPct: Number(process.env.MIN_PAIR_CHANGE_24H_PCT ?? -18),
  maxPairPriceChange24hPct: Number(process.env.MAX_PAIR_CHANGE_24H_PCT ?? 45),
  minPoolFeeApr7dPct: Number(process.env.MIN_POOL_FEE_APR_7D_PCT ?? 60),
  minPoolFeeApr24hPct: Number(process.env.MIN_POOL_FEE_APR_24H_PCT ?? 50),
  minPositionFeeApr7dPct: Number(process.env.MIN_POSITION_FEE_APR_7D_PCT ?? 150),
  minPositionFeeApr24hPct: Number(process.env.MIN_POSITION_FEE_APR_24H_PCT ?? 120),
  minExpectedNetEdgePct: Number(process.env.MIN_EXPECTED_NET_EDGE_PCT ?? 1.0),
  minFeeCoverageRatio: Number(process.env.MIN_FEE_COVERAGE_RATIO ?? 2.0),
  maxInventoryDragPct7d: Number(process.env.MAX_INVENTORY_DRAG_7D_PCT ?? 1.0),
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
if (!(config.maxPositionAllocationPct > 0 && config.maxPositionAllocationPct <= 0.45)) {
  throw new Error('MAX_POSITION_ALLOCATION_PCT must be >0 and <=45%');
}
if (!(config.maxPortfolioUtilizationPct > 0 && config.maxPortfolioUtilizationPct <= 0.90)) {
  throw new Error('MAX_PORTFOLIO_UTILIZATION_PCT must be >0 and <=90%');
}
if (config.hardStopLossPct !== 50 || JSON.stringify(config.rebalanceLevelsPct) !== JSON.stringify([15, 30, 45])) {
  throw new Error('Asymmetric LP management is fixed to rebalance at 15/30/45% drawdown and hard stop at 50%');
}
if (config.minOrganicScore < 60 || config.maxBotHoldersPct > 30 || config.minTokenFeesSol < 30 ||
    config.minBinStep < 80 || config.maxBinStep > 125 || config.minFeeActiveTvlRatio < 0.05) {
  throw new Error('Meridian-style screening thresholds cannot be weakened below the conservative preset');
}
if (config.minPairAgeDays < 14 || config.minMarketCapUsd < 250_000 ||
    config.minPairLiquidityUsd < 50_000 || config.maxFdvToMarketCap > 2.5) {
  throw new Error('Pair-age and market-cap filters cannot be weakened below the conservative preset');
}
if (config.minPoolFeeApr24hPct < 50 || config.minPoolFeeApr7dPct < 60 ||
    config.minPositionFeeApr24hPct < 120 || config.minPositionFeeApr7dPct < 150 ||
    config.minExpectedNetEdgePct < 1 || config.minFeeCoverageRatio < 2 ||
    config.maxInventoryDragPct7d > 1) {
  throw new Error('Fee farming thresholds cannot be weakened below the conservative preset');
}
if (!Number.isInteger(config.maxOpenPositions) || config.maxOpenPositions < 1 || config.maxOpenPositions > 2) {
  throw new Error('MAX_OPEN_POSITIONS must be 1 or 2');
}
