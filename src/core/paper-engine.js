import { randomUUID } from 'node:crypto';
import { calculateIndicators } from './indicators.js';
import { planLpRange } from './range-planner.js';
import { assessLpEconomics, sizeLpPosition } from './lp-economics.js';
import { assessPairRisk } from './pair-risk.js';
import { clmmInventoryReturnPct, rangeExposure } from './impermanent-loss.js';
import { evaluateAsymmetricRebalance } from './asymmetric-rebalance.js';

export const METEORA_DLMM_PROGRAM_ID = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';

const DEFAULTS = {
  entry: 'hybrid',
  style: 'balanced-lp',
  exit: 'dynamic-lp',
  riskPerPositionPct: 0.003,
  maxPortfolioRiskPct: 0.006,
  maxPositionAllocationPct: 0.45,
  maxPortfolioUtilizationPct: 0.90,
  hardStopLossPct: 50,
  rebalanceLevelsPct: [15, 30, 45],
  rebalanceQuoteMaxAgeSec: 30,
  minWalletRankScore: 65,
  requireRankedWallets: true,
  maxTvlUsd: 150_000,
  maxMarketCapUsd: 10_000_000,
  minOrganicScore: 60,
  minQuoteOrganicScore: 60,
  maxBotHoldersPct: 30,
  minTokenFeesSol: 30,
  minBinStep: 80,
  maxBinStep: 125,
  minFeeActiveTvlRatio: 0.05,
  maxVolatility24hPct: 7,
  allowedLaunchpads: [],
  blockedLaunchpads: [],
  maxOpenPositions: 2,
  minTvlUsd: 25_000,
  minVolume24hUsd: 10_000,
  maxPoolDataAgeSec: 90,
  maxSecurityDataAgeSec: 300,
  maxCandle5mAgeSec: 360,
  maxCandle30mAgeSec: 2_100,
  minWalletDepositUsd: 25,
  walletConvergenceThreshold: 2,
  walletWindowMs: 120_000,
  meteoraProgramId: METEORA_DLMM_PROGRAM_ID,
  minTokenAgeDays: 14,
  minMarketCapUsd: 250_000,
  minPairAgeDays: 14,
  maxPairEvidenceAgeSec: 120,
  maxFdvToMarketCap: 2.5,
  minPairLiquidityUsd: 50_000,
  minLiquidityToMarketCap: 0.08,
  minTransactions24h: 50,
  minSells24h: 15,
  minSellBuyRatio: 0.35,
  maxSellBuyRatio: 3.5,
  minPairPriceChange24hPct: -18,
  maxPairPriceChange24hPct: 45,
  maxTop10HoldersPct: 35,
  maxTop10DevWalletPct: 15,
  minHolders: 200,
  minActiveTvlRatio: 0.30,
  minVolumeToActiveTvl: 0.20,
  maxVolumeToActiveTvl: 4.5,
  minPoolFeeApr24hPct: 50,
  minPoolFeeApr7dPct: 60,
  minPositionFeeApr24hPct: 120,
  minPositionFeeApr7dPct: 150,
  maxFeeSpikeRatio: 2.5,
  minExpectedNetEdgePct: 1.0,
  minFeeCoverageRatio: 2.0,
  feeCaptureShare: 0.65,
  expectedHoldHours: 168,
  roundTripCostBps: 30,
  maxVolatility24hPct: 7,
  maxStressLossPct: 8,
  maxLiquidityOutflowPct: -8,
  maxTrendAdx: 30,
  minTrendAdx: 8,
  minRsi5m: 42,
  maxRsi5m: 65,
  minVolumeRatio5m: 0.8,
  maxVolumeRatio5m: 3.5,
  maxInventoryDragPct7d: 1.0,
  stopLossFloorPct: 4,
  stopLossCeilingPct: 7.5,
  trailingActivationPct: 2.5,
  trailingGivebackPct: 1,
  takeProfitPct: 8,
  outOfRangeGraceMs: 15 * 60_000,
  minPositionAgeMs: 45 * 60_000,
  lowFeeAprPct: 75,
  feeDecayRatio: 0.60,
  missingFeeMarkConfirmations: 2,
  feeDecayConfirmations: 2,
  trendExitAdx: 22,
  trendExitConfirmations: 2,
  maxHoldMs: 7 * 24 * 60 * 60_000,
  poolCooldownMs: 30 * 60_000,
  maxDailyLossPct: 1.5,
  maxDrawdownPct: 5
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const isFiniteNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const utcDay = timestamp => new Date(timestamp).toISOString().slice(0, 10);

function timestampMs(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function uniqueVerifiedWalletEvents(signals, now, config, poolAddress, eventType) {
  if (!Array.isArray(signals)) return [];
  const byWallet = new Map();
  const seenInstructions = new Set();
  for (const signal of signals) {
    const time = timestampMs(signal.timestamp);
    const wallet = String(signal.walletGroup ?? signal.walletAddress ?? '').trim();
    const signature = String(signal.signature ?? '').trim();
    const index = Number(signal.instructionIndex);
    const id = signature + ':' + index;
    if (!wallet || signal.eventType !== eventType ||
        signal.verified !== true || signal.success !== true ||
        signal.programId !== config.meteoraProgramId ||
        signal.poolAddress !== poolAddress ||
        signal.quoteSide !== true ||
        !signature || !Number.isInteger(index) || seenInstructions.has(id) ||
        !Number.isFinite(time) || time > now || now - time > config.walletWindowMs ||
        !isFiniteNumber(signal.quoteAmountUsd) || Number(signal.quoteAmountUsd) < config.minWalletDepositUsd) continue;
    if (config.requireRankedWallets &&
        (signal.walletRankVerified !== true || signal.walletRankSource !== 'top-lp-wallet-index' ||
         !isFiniteNumber(signal.walletRankScore) || Number(signal.walletRankScore) < config.minWalletRankScore)) continue;
    seenInstructions.add(id);
    const prior = byWallet.get(wallet);
    if (!prior || time > prior.timestamp) {
      byWallet.set(wallet, {
        wallet,
        signature,
        instructionIndex: index,
        timestamp: time,
        quoteAmountUsd: Number(signal.quoteAmountUsd),
        walletRankScore: Number(signal.walletRankScore)
      });
    }
  }
  return [...byWallet.values()];
}

function checkSecurity(snapshot, config) {
  const s = snapshot.security ?? snapshot.pool?.security ?? {};
  const failures = [];
  if (s.verified !== true) failures.push('token security data not verified');
  if (s.mintAuthorityDisabled !== true) failures.push('mint authority not confirmed disabled');
  if (s.freezeAuthorityDisabled !== true) failures.push('freeze authority not confirmed disabled');
  if (s.honeypot !== false) failures.push('honeypot status not explicitly clear');
  if (s.scam !== false) failures.push('scam status not explicitly clear');
  if (!isFiniteNumber(s.dataAgeSec) || Number(s.dataAgeSec) > config.maxSecurityDataAgeSec) failures.push('security data stale or missing');
  if (!isFiniteNumber(s.top10HoldersPct) || Number(s.top10HoldersPct) > config.maxTop10HoldersPct) failures.push('top-holder concentration too high or unknown');
  if (!isFiniteNumber(s.top10DevWalletPct) || Number(s.top10DevWalletPct) > config.maxTop10DevWalletPct) failures.push('developer-wallet concentration too high or unknown');
  if (!isFiniteNumber(s.holders) || Number(s.holders) < config.minHolders) failures.push('holder count too low or unknown');
  if (!isFiniteNumber(s.tokenAgeDays) || Number(s.tokenAgeDays) < config.minTokenAgeDays) failures.push('token too new or age unknown');
  if (!isFiniteNumber(s.marketCapUsd) || Number(s.marketCapUsd) < config.minMarketCapUsd || Number(s.marketCapUsd) > config.maxMarketCapUsd) failures.push('market cap outside token screening limits');
  if (!isFiniteNumber(s.organicScore) || Number(s.organicScore) < config.minOrganicScore) failures.push('organic activity score too low or unknown');
  if (!isFiniteNumber(s.botHoldersPct) || Number(s.botHoldersPct) > config.maxBotHoldersPct) failures.push('bot holder concentration too high or unknown');
  if (!isFiniteNumber(s.tokenFeesSol) || Number(s.tokenFeesSol) < config.minTokenFeesSol) failures.push('token fee activity below threshold or unknown');
  if (s.devBlocked !== false) failures.push('developer blocklist status is not explicitly clear');
  if (config.allowedLaunchpads.length && !config.allowedLaunchpads.includes(s.launchpad)) failures.push('launchpad is not allowlisted');
  if (config.blockedLaunchpads.includes(s.launchpad)) failures.push('launchpad is blocked');
  return { eligible: failures.length === 0, failures, snapshot: s };
}

function checkMarketData(snapshot, config) {
  const age = snapshot.marketData ?? {};
  const failures = [];
  if (!isFiniteNumber(age.candles5mAgeSec) || Number(age.candles5mAgeSec) > config.maxCandle5mAgeSec) failures.push('5m candles stale or missing');
  if (!isFiniteNumber(age.candles30mAgeSec) || Number(age.candles30mAgeSec) > config.maxCandle30mAgeSec) failures.push('30m candles stale or missing');
  return { eligible: failures.length === 0, failures };
}

export class PaperTradingEngine {
  constructor({ initialEquityUsd, analyst = null, config = {} } = {}) {
    if (!(Number.isFinite(initialEquityUsd) && initialEquityUsd > 0)) {
      throw new Error('initialEquityUsd must be positive; set PAPER_STARTING_EQUITY_USD or SOL_PRICE_USD');
    }
    this.config = Object.freeze({ ...DEFAULTS, ...config });
    if (this.config.entry !== 'hybrid' || this.config.style !== 'balanced-lp' || this.config.exit !== 'dynamic-lp') {
      throw new Error('This implementation supports hybrid / balanced-lp / dynamic-lp preset only');
    }
    for (const key of ['riskPerPositionPct', 'maxPortfolioRiskPct']) {
      if (!(this.config[key] > 0 && this.config[key] <= 0.01)) throw new Error(key + ' must be >0 and <=1%');
    }
    if (this.config.maxPortfolioRiskPct < this.config.riskPerPositionPct) throw new Error('Portfolio risk cannot be below per-position risk');
    if (!(this.config.maxPositionAllocationPct > 0 && this.config.maxPositionAllocationPct <= 0.45)) {
      throw new Error('Per-position capital allocation must be >0 and <=45%');
    }
    if (!(this.config.maxPortfolioUtilizationPct > 0 && this.config.maxPortfolioUtilizationPct <= 0.90)) {
      throw new Error('Portfolio capital utilization must be >0 and <=90%');
    }
    if (this.config.hardStopLossPct !== 50 || JSON.stringify(this.config.rebalanceLevelsPct) !== JSON.stringify([15, 30, 45])) {
      throw new Error('Asymmetric management is fixed to -15/-30/-45% rebalance and -50% hard stop');
    }
    if (!Number.isInteger(this.config.maxOpenPositions) || this.config.maxOpenPositions < 1 || this.config.maxOpenPositions > 2) {
      throw new Error('Balanced LP preset supports 1 or 2 open positions');
    }
    if (this.config.minPoolFeeApr24hPct < 50 || this.config.minPoolFeeApr7dPct < 60 ||
        this.config.minPositionFeeApr24hPct < 120 || this.config.minPositionFeeApr7dPct < 150 ||
        this.config.minExpectedNetEdgePct < 1 || this.config.minFeeCoverageRatio < 2 ||
        this.config.maxInventoryDragPct7d > 1) {
      throw new Error('LP fee-farming thresholds cannot be weakened below the conservative preset');
    }
    this.initialEquityUsd = initialEquityUsd;
    this.cashUsd = initialEquityUsd;
    this.analyst = analyst;
    this.positions = new Map();
    this.closedTrades = [];
    this.lastProcessedAtByPool = new Map();
    this.lastClosedAtByPool = new Map();
    this.peakEquityUsd = initialEquityUsd;
    this.dayKey = null;
    this.dayStartEquityUsd = initialEquityUsd;
    this.dailyLossHalted = false;
  }

  get equityUsd() {
    let equity = this.cashUsd;
    for (const p of this.positions.values()) equity += p.allocationUsd + p.inventoryPnlUsd + p.feesAccruedUsd - p.estimatedRoundTripCostUsd;
    return equity;
  }

  get reservedRiskUsd() {
    return [...this.positions.values()].reduce((sum, p) => sum + p.reservedRiskUsd, 0);
  }

  get capitalUsedUsd() {
    return [...this.positions.values()].reduce((sum, p) => sum + p.allocationUsd, 0);
  }

  get availableCapitalUsd() {
    return Math.max(0, Math.min(this.cashUsd, this.equityUsd * this.config.maxPortfolioUtilizationPct - this.capitalUsedUsd));
  }

  summary() {
    const equity = this.equityUsd;
    const grossProfit = this.closedTrades.filter(t => t.netPnlUsd > 0).reduce((sum, t) => sum + t.netPnlUsd, 0);
    const grossLoss = Math.abs(this.closedTrades.filter(t => t.netPnlUsd < 0).reduce((sum, t) => sum + t.netPnlUsd, 0));
    const wins = this.closedTrades.filter(t => t.netPnlUsd > 0).length;
    const losses = this.closedTrades.filter(t => t.netPnlUsd < 0).length;
    return {
      mode: 'paper',
      strategy: { entry: this.config.entry, style: this.config.style, exit: this.config.exit },
      initialEquityUsd: this.initialEquityUsd,
      equityUsd: equity,
      cashUsd: this.cashUsd,
      openPositions: this.positions.size,
      closedTrades: this.closedTrades.length,
      winRatePct: this.closedTrades.length ? wins / this.closedTrades.length * 100 : null,
      grossProfitUsd: grossProfit,
      grossLossUsd: grossLoss,
      netRealizedPnlUsd: this.closedTrades.reduce((sum, t) => sum + t.netPnlUsd, 0),
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 'infinite' : null,
      reservedRiskUsd: this.reservedRiskUsd,
      capitalUsedUsd: this.capitalUsedUsd,
      capitalUtilizationPct: equity > 0 ? this.capitalUsedUsd / equity * 100 : 0,
      maxPortfolioUtilizationPct: this.config.maxPortfolioUtilizationPct,
      unallocatedReserveUsd: Math.max(0, equity - this.capitalUsedUsd),
      reservedPortfolioRiskPct: equity > 0 ? this.reservedRiskUsd / equity * 100 : 0,
      dailyLossHalted: this.dailyLossHalted,
      peakEquityUsd: this.peakEquityUsd,
      drawdownPct: this.peakEquityUsd > 0 ? (this.peakEquityUsd - equity) / this.peakEquityUsd * 100 : 0,
      paperOnly: true,
      executionEnabled: false
    };
  }

  evaluateEntry(snapshot, now = Date.now()) {
    const pool = snapshot?.pool ?? {};
    const poolAddress = String(pool.poolAddress ?? pool.address ?? '').trim();
    const fail = (reason, more = {}) => ({ eligible: false, reason, poolAddress: poolAddress || null, ...more });
    if (!poolAddress) return fail('missing pool address');

    const poolAge = Number(pool.dataAgeSec);
    if (!isFiniteNumber(pool.tvlUsd) || Number(pool.tvlUsd) < this.config.minTvlUsd || Number(pool.tvlUsd) > this.config.maxTvlUsd) return fail('TVL outside allowed range');
    if (!isFiniteNumber(pool.binStep) || Number(pool.binStep) < this.config.minBinStep || Number(pool.binStep) > this.config.maxBinStep) return fail('Meteora bin step outside screening range');
    if (!isFiniteNumber(pool.feeActiveTvlRatio) || Number(pool.feeActiveTvlRatio) < this.config.minFeeActiveTvlRatio) return fail('fee/active-TVL ratio below screening floor');
    if (!isFiniteNumber(pool.quoteOrganicScore) || Number(pool.quoteOrganicScore) < this.config.minQuoteOrganicScore) return fail('quote-side organic score too low or unknown');
    if (!isFiniteNumber(pool.activeTvlUsd) || Number(pool.activeTvlUsd) <= 0) return fail('active TVL missing');
    if (!isFiniteNumber(pool.volume24hUsd) || Number(pool.volume24hUsd) < this.config.minVolume24hUsd) return fail('24h volume below floor');
    if (!isFiniteNumber(pool.fees24hUsd) || !isFiniteNumber(pool.fees7dUsd) || Number(pool.fees24hUsd) < 0 || Number(pool.fees7dUsd) <= 0) {
      return fail('24h and 7d fee history required');
    }
    if (!isFiniteNumber(pool.dataAgeSec) || poolAge > this.config.maxPoolDataAgeSec) return fail('pool data stale or missing');
    if (Number(pool.volume24hUsd) / Number(pool.activeTvlUsd) > this.config.maxVolumeToActiveTvl ||
        Number(pool.volume24hUsd) / Number(pool.activeTvlUsd) < this.config.minVolumeToActiveTvl) return fail('volume/active-TVL outside healthy band');
    if (pool.audit?.critical === true || snapshot.security?.critical === true) return fail('critical token/pool audit finding');

    const security = checkSecurity(snapshot, this.config);
    if (!security.eligible) return fail('security gate failed', { hardFails: security.failures });

    const pairRisk = assessPairRisk({
      pairEvidence: snapshot.pairEvidence,
      poolAddress,
      tokenMint: pool.tokenMint ?? pool.baseMint,
      now,
      minPairAgeDays: this.config.minPairAgeDays,
      maxPairEvidenceAgeSec: this.config.maxPairEvidenceAgeSec,
      minMarketCapUsd: this.config.minMarketCapUsd,
      maxMarketCapUsd: this.config.maxMarketCapUsd,
      maxFdvToMarketCap: this.config.maxFdvToMarketCap,
      minPairLiquidityUsd: this.config.minPairLiquidityUsd,
      minLiquidityToMarketCap: this.config.minLiquidityToMarketCap,
      minTransactions24h: this.config.minTransactions24h,
      minSells24h: this.config.minSells24h,
      minSellBuyRatio: this.config.minSellBuyRatio,
      maxSellBuyRatio: this.config.maxSellBuyRatio,
      minPriceChange24hPct: this.config.minPairPriceChange24hPct,
      maxPriceChange24hPct: this.config.maxPairPriceChange24hPct
    });
    if (!pairRisk.eligible) return fail('pair age / market-cap / liquidity safety gate failed', { hardFails: pairRisk.failures, pairRisk });

    const marketFresh = checkMarketData(snapshot, this.config);
    if (!marketFresh.eligible) return fail('market-data gate failed', { hardFails: marketFresh.failures });

    let five, thirty;
    try {
      five = calculateIndicators(snapshot.candles5m);
      thirty = calculateIndicators(snapshot.candles30m);
    } catch (error) {
      return fail('invalid OHLCV: ' + error.message);
    }

    const bbPosition = five.bb.upper > five.bb.lower
      ? (five.price - five.bb.lower) / (five.bb.upper - five.bb.lower) * 100 : 50;
    const marketPass =
      five.supertrend === 'bullish' &&
      thirty.supertrend === 'bullish' &&
      thirty.price > thirty.ema50 &&
      five.macdBias === 'bullish' &&
      thirty.macdBias !== 'bearish' &&
      five.rsi >= this.config.minRsi5m && five.rsi <= this.config.maxRsi5m &&
      thirty.adx >= this.config.minTrendAdx && thirty.adx <= this.config.maxTrendAdx &&
      five.volumeRatio >= this.config.minVolumeRatio5m &&
      five.volumeRatio <= this.config.maxVolumeRatio5m &&
      bbPosition >= 10 && bbPosition <= 85;
    if (!marketPass) {
      return fail('market confirmation failed', {
        technical: { supertrend5m: five.supertrend, supertrend30m: thirty.supertrend,
          macd5m: five.macdBias, rsi5m: five.rsi, adx30m: thirty.adx,
          volumeRatio5m: five.volumeRatio, bbPositionPct: bbPosition }
      });
    }

    const walletAdds = uniqueVerifiedWalletEvents(snapshot.walletSignals, now, this.config, poolAddress, 'add-liquidity');
    if (walletAdds.length < this.config.walletConvergenceThreshold) {
      return fail('verified wallet LP convergence below threshold', { walletCount: walletAdds.length });
    }

    const walletActivity = snapshot.walletActivity ?? null;
    if (walletActivity) {
      if (walletActivity.verified !== true || walletActivity.source !== 'helius-wallet-monitor' ||
          !isFiniteNumber(walletActivity.dataAgeSec) || Number(walletActivity.dataAgeSec) > this.config.maxPoolDataAgeSec ||
          !isFiniteNumber(walletActivity.uniqueActiveWallets24h) || Number(walletActivity.uniqueActiveWallets24h) < this.config.walletConvergenceThreshold ||
          !isFiniteNumber(walletActivity.walletActivityScore) || Number(walletActivity.walletActivityScore) < this.config.minWalletRankScore ||
          !isFiniteNumber(walletActivity.netQuoteFlowUsd) || Number(walletActivity.netQuoteFlowUsd) < 0) {
        return fail('verified LP wallet activity/flow gate failed', { walletActivity });
      }
    }

    const lpRisk = snapshot.lpRisk ?? {};
    if (lpRisk.verified !== true || lpRisk.source !== 'meteora-bin-stress-simulator') {
      return fail('verified bin-level LP stress simulation required');
    }
    if (!isFiniteNumber(lpRisk.stressLossPct) || Number(lpRisk.stressLossPct) <= 0 ||
        Number(lpRisk.stressLossPct) > this.config.maxStressLossPct) return fail('bin stress-loss outside risk ceiling');
    if (!isFiniteNumber(lpRisk.expectedInventoryDragPct7d) ||
        Number(lpRisk.expectedInventoryDragPct7d) > this.config.maxInventoryDragPct7d ||
        Number(lpRisk.expectedInventoryDragPct7d) < 0) return fail('7d inventory-drag estimate missing or too high');
    if (lpRisk.feeModelVerified !== true || lpRisk.feeModelSource !== 'meteora-position-v2-bin-fee-replay' ||
        !isFiniteNumber(lpRisk.positionFeeApr24hPct) || Number(lpRisk.positionFeeApr24hPct) <= 0 ||
        !isFiniteNumber(lpRisk.positionFeeApr7dPct) || Number(lpRisk.positionFeeApr7dPct) <= 0) {
      return fail('verified position-specific per-bin fee replay required; pool APR alone is insufficient');
    }
    if (!isFiniteNumber(lpRisk.simulatedRangeCoveragePct) || Number(lpRisk.simulatedRangeCoveragePct) < 90) {
      return fail('simulated bin range coverage below 90%');
    }

    let economics;
    try {
      economics = assessLpEconomics({
        tvlUsd: Number(pool.tvlUsd),
        activeTvlUsd: Number(pool.activeTvlUsd),
        volume24hUsd: Number(pool.volume24hUsd),
        fees24hUsd: Number(pool.fees24hUsd),
        fees7dUsd: Number(pool.fees7dUsd),
        positionFeeApr24hPct: Number(lpRisk.positionFeeApr24hPct),
        positionFeeApr7dPct: Number(lpRisk.positionFeeApr7dPct),
        allocationUsd: Math.min(this.equityUsd * this.config.maxPositionAllocationPct, this.availableCapitalUsd),
        volatility24hPct: Number(pool.volatility24hPct),
        liquidityTrend24hPct: Number(pool.liquidityTrend24hPct),
        stressLossPct: Number(lpRisk.stressLossPct),
        expectedInventoryDragPct: Number(lpRisk.expectedInventoryDragPct7d),
        roundTripCostBps: this.config.roundTripCostBps,
        feeCaptureShare: this.config.feeCaptureShare,
        expectedHoldHours: this.config.expectedHoldHours,
        minPoolFeeApr7dPct: this.config.minPoolFeeApr7dPct,
        minPoolFeeApr24hPct: this.config.minPoolFeeApr24hPct,
        minPositionFeeApr7dPct: this.config.minPositionFeeApr7dPct,
        minPositionFeeApr24hPct: this.config.minPositionFeeApr24hPct,
        minNetEdgePct: this.config.minExpectedNetEdgePct,
        minFeeCoverageRatio: this.config.minFeeCoverageRatio,
        maxInventoryDragPct7d: this.config.maxInventoryDragPct7d,
        maxFeeSpikeRatio: this.config.maxFeeSpikeRatio,
        minActiveTvlRatio: this.config.minActiveTvlRatio,
        minVolumeToActiveTvl: this.config.minVolumeToActiveTvl,
        maxVolumeToActiveTvl: this.config.maxVolumeToActiveTvl,
        maxVolatility24hPct: this.config.maxVolatility24hPct,
        maxStressLossPct: this.config.maxStressLossPct,
        maxLiquidityOutflowPct: this.config.maxLiquidityOutflowPct
      });
    } catch (error) {
      return fail('LP economics could not be evaluated: ' + error.message);
    }
    if (!economics.eligible) return fail('LP economics gate failed', { hardFails: economics.hardFails, economics });

    const securityScore = 100;
    const averageWalletRankScore = walletAdds.reduce((sum, event) => sum + event.walletRankScore, 0) / Math.max(1, walletAdds.length);
    const convergenceScore = clamp(walletAdds.length / 4, 0, 1) * 100;
    const walletScore = clamp(convergenceScore * 0.35 + averageWalletRankScore * 0.65, 0, 100);
    const technicalScore = clamp(
      35 + (five.rsi >= 48 && five.rsi <= 60 ? 15 : 5) +
      (thirty.adx <= 25 ? 15 : 5) + (five.volumeRatio >= 1 && five.volumeRatio <= 2.5 ? 15 : 5) +
      clamp(85 - bbPosition, 0, 15), 0, 100
    );
    const economyScore = clamp(100 - Math.max(0, economics.poolFeeApr24hPct / Math.max(economics.poolFeeApr7dPct, 1) - 1) * 40, 0, 100);
    const hybridScore = Math.round(securityScore * 0.20 + walletScore * 0.20 + technicalScore * 0.25 + economyScore * 0.35);
    if (hybridScore < 70) return fail('hybrid LP score below threshold', { hybridScore, economics });

    const range = planLpRange({
      price: five.price,
      atr: five.atr,
      volatility24hPct: Number(pool.volatility24hPct)
    });
    const stopLossPct = this.config.hardStopLossPct;
    return {
      eligible: true,
      reason: 'hybrid LP filters and positive net edge passed',
      poolAddress,
      tokenMint: pool.tokenMint ?? pool.baseMint ?? null,
      hybridScore,
      walletCount: walletAdds.length,
      walletAdds,
      walletActivity: walletActivity ? structuredClone(walletActivity) : null,
      averageWalletRankScore,
      technical: { five, thirty, bbPositionPct: bbPosition },
      security: { verified: true, holders: security.snapshot.holders },
      pairRisk,
      economics,
      lpRisk: structuredClone(lpRisk),
      range,
      stopLossPct
    };
  }

  _rollRiskDay(now) {
    const day = utcDay(now);
    if (this.dayKey !== day) {
      this.dayKey = day;
      this.dayStartEquityUsd = this.equityUsd;
      this.dailyLossHalted = false;
    }
    const dayReturnPct = this.dayStartEquityUsd > 0
      ? (this.equityUsd / this.dayStartEquityUsd - 1) * 100 : 0;
    if (dayReturnPct <= -this.config.maxDailyLossPct) this.dailyLossHalted = true;
    this.peakEquityUsd = Math.max(this.peakEquityUsd, this.equityUsd);
    const drawdownPct = this.peakEquityUsd > 0 ? (this.peakEquityUsd - this.equityUsd) / this.peakEquityUsd * 100 : 0;
    return { dayReturnPct, drawdownPct };
  }

  _markPosition(position, snapshot, now) {
    const pool = snapshot.pool ?? {};
    const mark = snapshot.lpMark ?? {};
    const price = Number(snapshot.priceUsd ?? snapshot.candles5m?.at(-1)?.close);
    if (!(price > 0 && Number.isFinite(price))) throw new Error('Paper mark needs a positive current USD price');
    const elapsedMs = Math.max(0, now - position.lastMarkedAt);
    const hours = elapsedMs / 3_600_000;
    const exposure = rangeExposure({ price, lower: position.range.lower, upper: position.range.upper });
    const inRange = typeof mark.inRange === 'boolean' ? mark.inRange
      : typeof snapshot.inRange === 'boolean' ? snapshot.inRange : exposure.inRange;

    if (isFiniteNumber(mark.inventoryPnlUsd)) {
      position.inventoryPnlUsd = Number(mark.inventoryPnlUsd);
      position.markAccuracy = 'bin-simulator-inventory-usd';
    } else if (isFiniteNumber(mark.inventoryPnlPct)) {
      position.inventoryPnlUsd = position.allocationUsd * Number(mark.inventoryPnlPct) / 100;
      position.markAccuracy = 'bin-simulator-inventory-pct';
    } else if (isFiniteNumber(snapshot.inventoryPnlPct)) {
      position.inventoryPnlUsd = position.allocationUsd * Number(snapshot.inventoryPnlPct) / 100;
      position.markAccuracy = 'external-inventory-pct';
    } else {
      const modeled = clmmInventoryReturnPct({
        initialPrice: position.entryPrice,
        price,
        lower: position.range.lower,
        upper: position.range.upper,
        capitalUsd: position.allocationUsd
      });
      position.inventoryPnlUsd = position.allocationUsd * modeled.pnlVsInitialPct / 100;
      position.markAccuracy = 'approximate-clmm-fallback';
    }

    const verifiedFeeMark =
      mark.verified === true &&
      mark.source === 'meteora-position-v2-bin-fee-replay' &&
      isFiniteNumber(mark.feesSinceLastUsd) &&
      Number(mark.feesSinceLastUsd) >= 0 &&
      isFiniteNumber(mark.positionFeeApr24hPct) &&
      isFiniteNumber(mark.positionFeeApr7dPct) &&
      Number(mark.positionFeeApr24hPct) >= 0 &&
      Number(mark.positionFeeApr7dPct) >= 0;

    if (verifiedFeeMark) {
      position.feesAccruedUsd += Number(mark.feesSinceLastUsd);
      position.feeApr24hPct = Number(mark.positionFeeApr24hPct) * this.config.feeCaptureShare;
      position.feeApr7dPct = Number(mark.positionFeeApr7dPct) * this.config.feeCaptureShare;
      position.currentFeeAprPct = Math.min(position.feeApr24hPct, position.feeApr7dPct);
      position.missingFeeMarkCount = 0;
      position.feeMarkAccuracy = 'verified-position-v2-bin-fee-replay';
    } else {
      position.missingFeeMarkCount = (position.missingFeeMarkCount ?? 0) + 1;
      position.feeApr24hPct = 0;
      position.feeApr7dPct = 0;
      position.currentFeeAprPct = 0;
      position.feeMarkAccuracy = 'missing-unverified-bin-fee-mark';
    }

    position.currentPrice = price;
    position.priceDrawdownPct = (price / position.entryPrice - 1) * 100;
    position.currentInRange = inRange;
    position.outOfRangeSince = inRange ? null : (position.outOfRangeSince ?? now);

    if (isFiniteNumber(mark.closeCostUsd)) position.lastMarkCloseCostUsd = Math.max(0, Number(mark.closeCostUsd));
    if (isFiniteNumber(mark.inventoryPnlPct) || isFiniteNumber(mark.inventoryPnlUsd)) position.lastStressLossPct = Number(mark.stressLossPct ?? position.stressLossPct);

    let trendBearish = false;
    try {
      const thirty = calculateIndicators(snapshot.candles30m);
      trendBearish = thirty.supertrend === 'bearish' && thirty.adx >= this.config.trendExitAdx;
      position.lastAdx30m = thirty.adx;
    } catch {
      trendBearish = false;
    }
    position.trendReversalCount = trendBearish ? position.trendReversalCount + 1 : 0;

    const removeEvents = uniqueVerifiedWalletEvents(snapshot.walletSignals, now, this.config, position.poolAddress, 'remove-liquidity');
    position.walletWithdrawalCount = removeEvents.length;

    const feeWeak = position.ageMs >= this.config.minPositionAgeMs &&
      (position.currentFeeAprPct < this.config.lowFeeAprPct ||
       position.currentFeeAprPct < position.entryFeeAprPct * this.config.feeDecayRatio);
    position.feeDecayCount = feeWeak ? position.feeDecayCount + 1 : 0;

    position.lastMarkedAt = now;
    position.ageMs = Math.max(0, now - position.openedAt);
    position.netPnlUsd = position.inventoryPnlUsd + position.feesAccruedUsd - position.estimatedRoundTripCostUsd;
    position.netPnlPct = position.allocationUsd > 0 ? position.netPnlUsd / position.allocationUsd * 100 : -100;
    position.peakPnlPct = Math.max(position.peakPnlPct, position.netPnlPct);
    position.currentNetFeeEdgePct = position.currentFeeAprPct * this.config.expectedHoldHours / 8760 -
      this.config.roundTripCostBps / 100 - position.lpRisk.expectedInventoryDragPct7d;
    return position;
  }

  _exitReason(position, now) {
    if (position.priceDrawdownPct <= -this.config.hardStopLossPct) return 'asymmetric-price-hard-stop';
    if (position.walletWithdrawalCount >= this.config.walletConvergenceThreshold) return 'tracked-wallet-liquidity-withdrawal';
    if ((position.missingFeeMarkCount ?? 0) >= this.config.missingFeeMarkConfirmations) return 'missing-verified-position-fee-mark';
    if (position.outOfRangeSince != null && now - position.outOfRangeSince >= this.config.outOfRangeGraceMs) return 'out-of-range-timeout';
    if (position.trendReversalCount >= this.config.trendExitConfirmations) return '30m-trend-reversal';
    if (position.feeDecayCount >= this.config.feeDecayConfirmations) return 'fee-yield-decay';
    if (position.peakPnlPct >= this.config.trailingActivationPct &&
        position.peakPnlPct - position.netPnlPct >= this.config.trailingGivebackPct &&
        position.netPnlPct > 0) return 'profit-trailing-lock';
    if (position.netPnlPct >= this.config.takeProfitPct) return 'net-profit-target';
    if (position.ageMs >= this.config.maxHoldMs) return 'maximum-holding-period';
    if (position.ageMs >= this.config.minPositionAgeMs && position.currentNetFeeEdgePct <= 0) return 'negative-forward-net-edge';
    return null;
  }

  _close(position, now, reason) {
    const netPnlUsd = position.inventoryPnlUsd + position.feesAccruedUsd - position.estimatedRoundTripCostUsd -
      Math.max(0, Number(position.lastMarkCloseCostUsd ?? 0));
    const returnedUsd = Math.max(0, position.allocationUsd + netPnlUsd);
    this.cashUsd += returnedUsd;
    const closed = {
      ...structuredClone(position),
      closedAt: now,
      reason,
      netPnlUsd,
      netPnlPct: netPnlUsd / position.allocationUsd * 100,
      returnedUsd
    };
    this.positions.delete(position.id);
    this.closedTrades.push(closed);
    this.lastClosedAtByPool.set(position.poolAddress, now);
    return closed;
  }

  async processSnapshot(snapshot) {
    const now = timestampMs(snapshot?.timestamp);
    if (!Number.isFinite(now)) throw new Error('snapshot.timestamp must be a valid Unix millisecond or ISO timestamp');
    const pool = snapshot.pool ?? {};
    const poolAddress = String(pool.poolAddress ?? pool.address ?? '').trim();
    if (!poolAddress) throw new Error('snapshot.pool.poolAddress is required');
    const last = this.lastProcessedAtByPool.get(poolAddress);
    if (last != null && now <= last) {
      return { status: 'duplicate-or-out-of-order', poolAddress, timestamp: now, portfolio: this.summary() };
    }

    const exits = [];
    const rebalances = [];
    const matching = [...this.positions.values()].filter(p => p.poolAddress === poolAddress);
    for (const position of matching) {
      this._markPosition(position, snapshot, now);
      const reason = this._exitReason(position, now);
      if (reason) {
        exits.push(this._close(position, now, reason));
        continue;
      }
      const rebalance = evaluateAsymmetricRebalance({
        position,
        currentPrice: position.currentPrice,
        quote: snapshot.rebalanceQuote,
        now,
        hardStopLossPct: this.config.hardStopLossPct,
        rebalanceLevelsPct: this.config.rebalanceLevelsPct,
        maxQuoteAgeSec: this.config.rebalanceQuoteMaxAgeSec
      });
      if (rebalance.status === 'rebalance-ready') {
        position.range = structuredClone(rebalance.nextRange);
        position.rebalanceLevelsCompleted = [...new Set([...(position.rebalanceLevelsCompleted ?? []), rebalance.levelPct])];
        position.rebalanceCount = position.rebalanceLevelsCompleted.length;
        position.lastRebalanceAt = now;
        position.lastRebalanceReason = `spot-drawdown-${rebalance.levelPct}pct`;
        rebalances.push({ positionId: position.id, ...rebalance, applied: true });
      } else if (rebalance.status === 'quote-required') {
        rebalances.push({ positionId: position.id, ...rebalance, applied: false });
      }
    }

    const risk = this._rollRiskDay(now);
    let entry = { status: 'not-evaluated' };
    if (this.positions.size >= this.config.maxOpenPositions) entry = { status: 'blocked', reason: 'max-open-positions' };
    else if ([...this.positions.values()].some(p => p.poolAddress === poolAddress)) entry = { status: 'blocked', reason: 'pool-already-open' };
    else if (this.dailyLossHalted || risk.dayReturnPct <= -this.config.maxDailyLossPct) {
      entry = { status: 'blocked', reason: 'daily-loss-circuit-breaker', risk };
    } else if (risk.drawdownPct >= this.config.maxDrawdownPct) {
      entry = { status: 'blocked', reason: 'portfolio-drawdown-circuit-breaker', risk };
    } else if (this.lastClosedAtByPool.has(poolAddress) &&
      now - this.lastClosedAtByPool.get(poolAddress) < this.config.poolCooldownMs) {
      entry = { status: 'blocked', reason: 'pool-cooldown' };
    } else if (this.availableCapitalUsd <= 0) {
      entry = { status: 'blocked', reason: '90-percent-portfolio-utilization-cap', capitalUsedUsd: this.capitalUsedUsd, maxPortfolioUtilizationPct: this.config.maxPortfolioUtilizationPct };
    } else {
      const evaluation = this.evaluateEntry(snapshot, now);
      if (!evaluation.eligible) entry = { status: 'no-entry', ...evaluation };
      else if (evaluation.tokenMint && [...this.positions.values()].some(p => p.tokenMint === evaluation.tokenMint)) {
        entry = { status: 'blocked', reason: 'correlated-token-position-already-open' };
      } else {
        const positionSize = sizeLpPosition({
          equityUsd: this.equityUsd,
          cashUsd: this.availableCapitalUsd,
          reservedRiskUsd: this.reservedRiskUsd,
          riskPerPositionPct: this.config.riskPerPositionPct,
          maxPortfolioRiskPct: this.config.maxPortfolioRiskPct,
          maxPositionAllocationPct: this.config.maxPositionAllocationPct,
          stopLossPct: evaluation.stopLossPct,
          stressLossPct: Number(evaluation.lpRisk.stressLossPct),
          roundTripCostBps: this.config.roundTripCostBps
        });
        if (!(positionSize.allocationUsd > 0)) {
          entry = { status: 'blocked', reason: 'risk-budget-exhausted', evaluation, positionSize };
        } else {
          const costUsd = positionSize.allocationUsd * this.config.roundTripCostBps / 10_000;
          const position = {
            id: randomUUID(),
            poolAddress,
            tokenMint: evaluation.tokenMint,
            chain: pool.chain ?? 'solana',
            symbol: pool.symbol ?? null,
            allocationUsd: positionSize.allocationUsd,
            reservedRiskUsd: positionSize.reservedRiskUsd,
            riskBudgetUsd: positionSize.positionRiskBudgetUsd,
            worstLossPct: positionSize.worstLossPct,
            stopLossPct: evaluation.stopLossPct,
            entryPrice: evaluation.technical.five.price,
            currentPrice: evaluation.technical.five.price,
            range: evaluation.range,
            lpRisk: evaluation.lpRisk,
            entryFeeAprPct: evaluation.economics.conservativePositionFeeAprPct * this.config.feeCaptureShare,
            entryNetEdgePct: evaluation.economics.expectedNetEdgePct,
            entryScore: evaluation.hybridScore,
            walletCount: evaluation.walletCount,
            initialAllocationUsd: positionSize.allocationUsd,
            rebalanceLevelsCompleted: [],
            rebalanceCount: 0,
            priceDrawdownPct: 0,
            openedAt: now,
            lastMarkedAt: now,
            ageMs: 0,
            feesAccruedUsd: 0,
            inventoryPnlUsd: 0,
            estimatedRoundTripCostUsd: costUsd,
            netPnlUsd: -costUsd,
            netPnlPct: -costUsd / positionSize.allocationUsd * 100,
            peakPnlPct: -costUsd / positionSize.allocationUsd * 100,
            currentInRange: true,
            outOfRangeSince: null,
            feeApr24hPct: evaluation.economics.positionFeeApr24hPct * this.config.feeCaptureShare,
            feeApr7dPct: evaluation.economics.positionFeeApr7dPct * this.config.feeCaptureShare,
            currentFeeAprPct: evaluation.economics.conservativePositionFeeAprPct * this.config.feeCaptureShare,
            missingFeeMarkCount: 0,
            feeDecayCount: 0,
            trendReversalCount: 0,
            walletWithdrawalCount: 0,
            lastMarkCloseCostUsd: 0,
            markAccuracy: 'entry-estimate',
            status: 'open'
          };
          this.cashUsd -= position.allocationUsd;
          this.positions.set(position.id, position);
          entry = { status: 'opened', position: structuredClone(position), evaluation, positionSize };
          if (this.analyst?.analyzePool) {
            try {
              const analysis = await this.analyst.analyzePool({
                chain: position.chain,
                protocol: 'Meteora DLMM',
                poolAddress,
                symbol: position.symbol,
                priceUsd: position.entryPrice,
                tvlUsd: pool.tvlUsd,
                volume24hUsd: pool.volume24hUsd,
                fees24hUsd: pool.fees24hUsd,
                walletCount: evaluation.walletCount,
                lpEconomics: evaluation.economics,
                timestamp: new Date(now).toISOString()
              });
              const live = this.positions.get(position.id);
              if (live) live.aiAnalysis = analysis;
              entry.aiAnalysis = analysis;
            } catch (error) {
              entry.aiAnalysisError = error.message;
            }
          }
        }
      }
    }

    this.lastProcessedAtByPool.set(poolAddress, now);
    return { status: 'processed', timestamp: now, poolAddress, entry, exits, rebalances, portfolio: this.summary() };
  }

  exportState() {
    return {
      version: 3,
      initialEquityUsd: this.initialEquityUsd,
      cashUsd: this.cashUsd,
      positions: [...this.positions.values()],
      closedTrades: this.closedTrades,
      lastProcessedAtByPool: Object.fromEntries(this.lastProcessedAtByPool),
      lastClosedAtByPool: Object.fromEntries(this.lastClosedAtByPool),
      peakEquityUsd: this.peakEquityUsd,
      dayKey: this.dayKey,
      dayStartEquityUsd: this.dayStartEquityUsd,
      dailyLossHalted: this.dailyLossHalted
    };
  }

  static fromState(state, { analyst = null, config = {} } = {}) {
    if (![2, 3].includes(state?.version) || !(Number(state.initialEquityUsd) > 0)) {
      throw new Error('Unsupported paper state version; archive old state and start a new LP paper account');
    }
    const engine = new PaperTradingEngine({ initialEquityUsd: Number(state.initialEquityUsd), analyst, config });
    engine.cashUsd = Number(state.cashUsd);
    if (!Number.isFinite(engine.cashUsd) || engine.cashUsd < 0) throw new Error('Paper state cash balance invalid');
    engine.positions = new Map((state.positions ?? []).map(p => [p.id, { ...p, initialAllocationUsd: p.initialAllocationUsd ?? p.allocationUsd, rebalanceLevelsCompleted: p.rebalanceLevelsCompleted ?? [], rebalanceCount: p.rebalanceCount ?? 0, priceDrawdownPct: p.priceDrawdownPct ?? 0 }]));
    engine.closedTrades = state.closedTrades ?? [];
    engine.lastProcessedAtByPool = new Map(Object.entries(state.lastProcessedAtByPool ?? {}).map(([k, v]) => [k, Number(v)]));
    engine.lastClosedAtByPool = new Map(Object.entries(state.lastClosedAtByPool ?? {}).map(([k, v]) => [k, Number(v)]));
    engine.peakEquityUsd = Number(state.peakEquityUsd ?? state.initialEquityUsd);
    engine.dayKey = state.dayKey ?? null;
    engine.dayStartEquityUsd = Number(state.dayStartEquityUsd ?? state.initialEquityUsd);
    engine.dailyLossHalted = Boolean(state.dailyLossHalted);
    return engine;
  }
}
