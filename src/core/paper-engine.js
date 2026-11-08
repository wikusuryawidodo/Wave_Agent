import { randomUUID } from 'node:crypto';
import { calculateIndicators } from './indicators.js';
import { scorePool } from './pool-score.js';
import { planRange } from './range-planner.js';
import { clmmInventoryReturnPct, rangeExposure } from './impermanent-loss.js';

const DEFAULTS = {
  entry: 'hybrid',
  style: 'balanced',
  exit: 'dynamic',
  riskPerPositionPct: 0.005,
  maxPortfolioRiskPct: 0.01,
  maxOpenPositions: 2,
  maxPositionAllocationPct: 0.25,
  stopLossPct: 8,
  trailingActivationPct: 3,
  trailingGivebackPct: 1.5,
  outOfRangeGraceMs: 30 * 60_000,
  lowFeeAprPct: 7,
  minPositionAgeMs: 60 * 60_000,
  walletConvergenceThreshold: 2,
  walletWindowMs: 120_000,
  minWalletDepositUsd: 10,
  minTvlUsd: 25_000,
  minVolume24hUsd: 10_000,
  maxVolumeToTvl: 8,
  maxPoolDataAgeSec: 90,
  minPoolScore: 65,
  minHybridScore: 75,
  feeCaptureShare: 0.7,
  roundTripCostBps: 25,
  poolCooldownMs: 10 * 60_000,
  maxDailyLossPct: 2,
  maxDrawdownPct: 8
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const utcDay = timestamp => new Date(timestamp).toISOString().slice(0, 10);

function timestampMs(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function walletConvergence(signals, now, config) {
  if (!Array.isArray(signals)) return [];
  const groups = new Map();
  for (const signal of signals) {
    const eventAt = timestampMs(signal.timestamp, NaN);
    const eventType = String(signal.eventType ?? '').toLowerCase().replaceAll('_', '-');
    const wallet = String(signal.walletGroup ?? signal.walletAddress ?? '').trim();
    const quoteUsd = Number(signal.quoteAmountUsd);
    if (!wallet || eventType !== 'add-liquidity' || signal.success === false ||
        signal.inRange === false || !Number.isFinite(eventAt) || eventAt > now ||
        now - eventAt > config.walletWindowMs ||
        !Number.isFinite(quoteUsd) || quoteUsd < config.minWalletDepositUsd) continue;
    const previous = groups.get(wallet);
    if (!previous || eventAt > previous.timestamp) groups.set(wallet, { wallet, timestamp: eventAt, quoteAmountUsd: quoteUsd });
  }
  return [...groups.values()];
}

function validPoolAddress(pool) {
  return String(pool?.poolAddress ?? pool?.address ?? '').trim();
}

export class PaperTradingEngine {
  constructor({ initialEquityUsd, analyst = null, config = {} } = {}) {
    if (!(Number.isFinite(initialEquityUsd) && initialEquityUsd > 0)) {
      throw new Error('initialEquityUsd must be a positive USD amount; set PAPER_STARTING_EQUITY_USD or SOL_PRICE_USD');
    }
    this.config = Object.freeze({ ...DEFAULTS, ...config });
    if (this.config.entry !== 'hybrid' || this.config.style !== 'balanced' || this.config.exit !== 'dynamic') {
      throw new Error('This engine version supports the configured hybrid/balanced/dynamic preset only');
    }
    for (const key of ['riskPerPositionPct', 'maxPortfolioRiskPct']) {
      if (!(this.config[key] > 0 && this.config[key] <= 0.01)) throw new Error(`${key} must be >0 and <=1%`);
    }
    if (!Number.isInteger(this.config.maxOpenPositions) || this.config.maxOpenPositions < 1 || this.config.maxOpenPositions > 2) {\n      throw new Error('maxOpenPositions must be 1 or 2 for balanced risk preset');\n    }\n    if (!(this.config.maxPositionAllocationPct > 0 && this.config.maxPositionAllocationPct <= 0.25)) {\n      throw new Error('maxPositionAllocationPct must be >0 and <=25%');\n    }\n    if (this.config.maxPortfolioRiskPct < this.config.riskPerPositionPct) {
      throw new Error('maxPortfolioRiskPct cannot be below riskPerPositionPct');
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
    for (const p of this.positions.values()) {
      equity += p.allocationUsd + p.inventoryPnlUsd + p.feesAccruedUsd - p.estimatedRoundTripCostUsd;
    }
    return equity;
  }

  get reservedRiskUsd() {
    return [...this.positions.values()].reduce((sum, p) => sum + p.reservedRiskUsd, 0);
  }

  summary() {
    const equityUsd = this.equityUsd;
    return {
      mode: 'paper',
      strategy: { entry: this.config.entry, style: this.config.style, exit: this.config.exit },
      initialEquityUsd: this.initialEquityUsd,
      equityUsd,
      cashUsd: this.cashUsd,
      openPositions: this.positions.size,
      reservedRiskUsd: this.reservedRiskUsd,
      reservedPortfolioRiskPct: equityUsd > 0 ? this.reservedRiskUsd / equityUsd * 100 : 0,
      realizedPnlUsd: this.closedTrades.reduce((sum, t) => sum + t.netPnlUsd, 0),
      dailyLossHalted: this.dailyLossHalted,
      peakEquityUsd: this.peakEquityUsd,
      drawdownPct: this.peakEquityUsd > 0 ? (this.peakEquityUsd - equityUsd) / this.peakEquityUsd * 100 : 0,
      paperOnly: true,
      executionEnabled: false
    };
  }

  evaluateEntry(snapshot, now = Date.now()) {
    const pool = snapshot?.pool ?? {};
    const poolAddress = validPoolAddress(pool);
    const fail = reason => ({ eligible: false, reason, poolAddress, score: null });
    if (!poolAddress) return fail('missing pool address');
    if (!finite(pool.tvlUsd) || Number(pool.tvlUsd) < this.config.minTvlUsd) return fail('TVL below minimum or missing');
    if (!finite(pool.volume24hUsd) || Number(pool.volume24hUsd) < this.config.minVolume24hUsd) return fail('24h volume below minimum or missing');
    if (!finite(pool.fees24hUsd) || Number(pool.fees24hUsd) < 0) return fail('24h fees invalid or missing');
    if (!finite(pool.dataAgeSec) || Number(pool.dataAgeSec) > this.config.maxPoolDataAgeSec) return fail('pool data stale or age unavailable');
    if (Number(pool.volume24hUsd) / Number(pool.tvlUsd) > this.config.maxVolumeToTvl) return fail('volume/TVL anomaly');
    if (pool.audit?.critical === true || snapshot.security?.critical === true) return fail('critical security flag');

    let technical, trend;
    let scored;
    try {
      technical = calculateIndicators(snapshot.candles5m);
      trend = calculateIndicators(snapshot.candles30m);
      scored = scorePool(pool, snapshot.candles5m, {
        minTvlUsd: this.config.minTvlUsd,
        minVolume24hUsd: this.config.minVolume24hUsd,
        maxVolumeToTvl: this.config.maxVolumeToTvl
      });
    } catch (error) {
      return fail(`market data invalid: ${error.message}`);
    }
    if (!scored.eligible || scored.hardFails.length) return { ...fail(scored.hardFails.join('; ') || 'technical score below threshold'), poolScore: scored.score };
    if (scored.score < this.config.minPoolScore) return { ...fail('pool/technical score below threshold'), poolScore: scored.score };

    const marketConfirmed =
      trend.supertrend === 'bullish' && trend.price >= trend.bb.mid &&
      technical.supertrend === 'bullish' && technical.macdBias === 'bullish' &&
      technical.rsi >= 45 && technical.rsi <= 68 &&
      technical.volumeRatio >= 1 && technical.price >= technical.bb.mid;
    if (!marketConfirmed) return { ...fail('multi-timeframe market confirmation failed'), poolScore: scored.score,
      market: { trend30m: trend.supertrend, macd5m: technical.macdBias, rsi5m: technical.rsi, volumeRatio5m: technical.volumeRatio } };

    const wallets = walletConvergence(snapshot.walletSignals, now, this.config);
    if (wallets.length < this.config.walletConvergenceThreshold) {
      return { ...fail('wallet convergence below threshold'), poolScore: scored.score, walletCount: wallets.length };
    }
    const walletScore = clamp(wallets.length / this.config.walletConvergenceThreshold * 100, 0, 100);
    const hybridScore = Math.round(scored.score * 0.65 + walletScore * 0.35);
    if (hybridScore < this.config.minHybridScore) return { ...fail('hybrid score below threshold'), poolScore: scored.score, hybridScore, walletCount: wallets.length };

    return {
      eligible: true,
      reason: 'hybrid filters passed',
      poolAddress,
      poolScore: scored.score,
      walletCount: wallets.length,
      wallets: wallets.map(({ wallet, timestamp, quoteAmountUsd }) => ({ wallet, timestamp, quoteAmountUsd })),
      hybridScore,
      technical,
      trend30m: trend,
      market: { trend30m: trend.supertrend, macd5m: technical.macdBias, rsi5m: technical.rsi, volumeRatio5m: technical.volumeRatio }
    };
  }

  _rollDay(now) {
    const key = utcDay(now);
    if (this.dayKey !== key) {
      this.dayKey = key;
      this.dayStartEquityUsd = this.equityUsd;
      this.dailyLossHalted = false;
    }
    const dailyReturnPct = this.dayStartEquityUsd > 0
      ? (this.equityUsd / this.dayStartEquityUsd - 1) * 100 : 0;
    if (dailyReturnPct <= -this.config.maxDailyLossPct) this.dailyLossHalted = true;
    this.peakEquityUsd = Math.max(this.peakEquityUsd, this.equityUsd);
    return { dailyReturnPct, drawdownPct: this.peakEquityUsd > 0
      ? (this.peakEquityUsd - this.equityUsd) / this.peakEquityUsd * 100 : 0 };
  }

  _markPosition(position, snapshot, now) {
    const pool = snapshot.pool;
    const price = Number(snapshot.priceUsd ?? snapshot.candles5m?.at(-1)?.close);
    if (!(price > 0) || !Number.isFinite(price)) throw new Error('snapshot priceUsd must be positive');
    const exposure = rangeExposure({ price, lower: position.range.lower, upper: position.range.upper });
    const inRange = typeof snapshot.inRange === 'boolean' ? snapshot.inRange : exposure.inRange;
    const elapsedMs = Math.max(0, now - position.lastMarkedAt);
    const hours = elapsedMs / 3_600_000;

    if (finite(snapshot.inventoryPnlPct)) {
      position.inventoryPnlUsd = position.allocationUsd * Number(snapshot.inventoryPnlPct) / 100;
      position.markSource = 'provided-inventory-pnl';
    } else {
      const modeled = clmmInventoryReturnPct({
        initialPrice: position.entryPrice,
        price,
        lower: position.range.lower,
        upper: position.range.upper,
        capitalUsd: position.allocationUsd
      });
      position.inventoryPnlUsd = position.allocationUsd * modeled.pnlVsInitialPct / 100;
      position.markSource = 'simplified-clmm-inventory-estimate';
    }

    const tvl = Number(pool.tvlUsd);
    const fees24h = Number(pool.fees24hUsd);
    if (hours > 0 && tvl > 0 && fees24h >= 0 && inRange) {
      position.feesAccruedUsd += fees24h * (position.allocationUsd / tvl) *
        this.config.feeCaptureShare * (hours / 24);
    }
    position.currentPrice = price;
    position.currentInRange = inRange;
    position.feeAprPct = tvl > 0 && fees24h >= 0
      ? fees24h / tvl * 365 * 100 * this.config.feeCaptureShare * (inRange ? 1 : 0)
      : 0;
    position.outOfRangeSince = inRange ? null : (position.outOfRangeSince ?? now);
    position.lastMarkedAt = now;
    position.netPnlUsd = position.inventoryPnlUsd + position.feesAccruedUsd - position.estimatedRoundTripCostUsd;
    position.netPnlPct = position.netPnlUsd / position.allocationUsd * 100;
    position.peakPnlPct = Math.max(position.peakPnlPct, position.netPnlPct);
    position.ageMs = Math.max(0, now - position.openedAt);
    return position;
  }

  _exitReason(position, now) {
    if (position.netPnlPct <= -this.config.stopLossPct) return 'hard-stop-loss';
    if (position.peakPnlPct >= this.config.trailingActivationPct &&
        position.peakPnlPct - position.netPnlPct >= this.config.trailingGivebackPct) return 'dynamic-trailing-stop';
    if (position.outOfRangeSince != null &&
        now - position.outOfRangeSince >= this.config.outOfRangeGraceMs) return 'out-of-range-timeout';
    if (position.ageMs >= this.config.minPositionAgeMs &&
        position.feeAprPct < this.config.lowFeeAprPct) return 'low-net-fee-yield';
    return null;
  }

  _close(position, now, reason) {
    const netPnlUsd = position.inventoryPnlUsd + position.feesAccruedUsd - position.estimatedRoundTripCostUsd;
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
    const now = timestampMs(snapshot?.timestamp, Date.now());
    if (!Number.isFinite(now)) throw new Error('snapshot.timestamp must be a valid millisecond timestamp or ISO date');
    const pool = snapshot?.pool ?? {};
    const poolAddress = validPoolAddress(pool);
    if (!poolAddress) throw new Error('snapshot.pool.poolAddress is required');
    const lastProcessed = this.lastProcessedAtByPool.get(poolAddress);
    if (lastProcessed != null && now <= lastProcessed) {
      return { status: 'duplicate-or-out-of-order', poolAddress, timestamp: now, portfolio: this.summary() };
    }
    this.lastProcessedAtByPool.set(poolAddress, now);

    const exits = [];
    const matching = [...this.positions.values()].filter(p => p.poolAddress === poolAddress);
    for (const position of matching) {
      this._markPosition(position, snapshot, now);
      const reason = this._exitReason(position, now);
      if (reason) exits.push(this._close(position, now, reason));
    }

    this._rollDay(now);
    let entry = { status: 'not-evaluated' };
    if (this.positions.size >= this.config.maxOpenPositions) entry = { status: 'blocked', reason: 'max-open-positions' };
    else if ([...this.positions.values()].some(p => p.poolAddress === poolAddress)) entry = { status: 'blocked', reason: 'pool-already-open' };
    else {
      const lastClosed = this.lastClosedAtByPool.get(poolAddress);
      if (lastClosed != null && now - lastClosed < this.config.poolCooldownMs) {
        entry = { status: 'blocked', reason: 'pool-cooldown' };
      } else {
        const riskState = this._rollDay(now);
        if (this.dailyLossHalted) entry = { status: 'blocked', reason: 'daily-loss-limit', riskState };
        else if (riskState.drawdownPct >= this.config.maxDrawdownPct) entry = { status: 'blocked', reason: 'peak-drawdown-limit', riskState };
        else {
          const evaluation = this.evaluateEntry(snapshot, now);
          if (!evaluation.eligible) entry = { status: 'no-entry', ...evaluation };
          else {
            const equity = this.equityUsd;
            const totalRiskCap = equity * this.config.maxPortfolioRiskPct;
            const remainingPortfolioRisk = Math.max(0, totalRiskCap - this.reservedRiskUsd);
            const positionRiskBudget = Math.min(equity * this.config.riskPerPositionPct, remainingPortfolioRisk);
            const stopAndCostsPct = this.config.stopLossPct + this.config.roundTripCostBps / 100;
            const riskSizedUsd = positionRiskBudget / (stopAndCostsPct / 100);
            const allocationUsd = Math.min(riskSizedUsd, equity * this.config.maxPositionAllocationPct, this.cashUsd);
            if (!(allocationUsd > 0) || positionRiskBudget <= 0) {
              entry = { status: 'blocked', reason: 'risk-budget-exhausted', evaluation };
            } else {
              const range = planRange({
                price: evaluation.technical.price,
                atr: evaluation.technical.atr,
                volatilityPct: evaluation.technical.atr / evaluation.technical.price * 100,
                trend: evaluation.technical.supertrend
              });
              const position = {
                id: randomUUID(),
                poolAddress,
                chain: pool.chain ?? 'unknown',
                symbol: pool.symbol ?? null,
                allocationUsd,
                reservedRiskUsd: allocationUsd * stopAndCostsPct / 100,
                riskBudgetUsd: positionRiskBudget,
                stopLossPct: this.config.stopLossPct,
                entryPrice: evaluation.technical.price,
                currentPrice: evaluation.technical.price,
                range,
                openedAt: now,
                lastMarkedAt: now,
                ageMs: 0,
                feesAccruedUsd: 0,
                inventoryPnlUsd: 0,
                netPnlUsd: -allocationUsd * this.config.roundTripCostBps / 10_000,
                netPnlPct: -this.config.roundTripCostBps / 100,
                peakPnlPct: -this.config.roundTripCostBps / 100,
                estimatedRoundTripCostUsd: allocationUsd * this.config.roundTripCostBps / 10_000,
                feeAprPct: 0,
                currentInRange: true,
                outOfRangeSince: null,
                markSource: 'entry-mark',
                entryScore: evaluation.hybridScore,
                poolScore: evaluation.poolScore,
                walletCount: evaluation.walletCount,
                status: 'open'
              };
              this.cashUsd -= allocationUsd;
              this.positions.set(position.id, position);
              entry = { status: 'opened', position: structuredClone(position), evaluation };
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
                    timestamp: new Date(now).toISOString()
                  });
                  // Advisory only: its score/recommendation is stored but never changes the deterministic decision.
                  const livePosition = this.positions.get(position.id);
                  if (livePosition) livePosition.aiAnalysis = analysis;
                  entry.aiAnalysis = analysis;
                } catch (error) {
                  entry.aiAnalysisError = error.message;
                }
              }
            }
          }
        }
      }
    }

    return { status: 'processed', timestamp: now, poolAddress, entry, exits, portfolio: this.summary() };
  }

  exportState() {
    return {
      version: 1,
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
    if (state?.version !== 1 || !(Number(state.initialEquityUsd) > 0)) throw new Error('Unsupported or invalid paper state');
    const engine = new PaperTradingEngine({ initialEquityUsd: Number(state.initialEquityUsd), analyst, config });
    engine.cashUsd = Number(state.cashUsd);
    if (!Number.isFinite(engine.cashUsd) || engine.cashUsd < 0) throw new Error('Paper state cash balance is invalid');
    engine.positions = new Map((state.positions ?? []).map(p => [p.id, p]));
    engine.closedTrades = state.closedTrades ?? [];
    engine.lastProcessedAtByPool = new Map(Object.entries(state.lastProcessedAtByPool ?? {}).map(([k,v]) => [k, Number(v)]));
    engine.lastClosedAtByPool = new Map(Object.entries(state.lastClosedAtByPool ?? {}).map(([k,v]) => [k, Number(v)]));
    engine.peakEquityUsd = Number(state.peakEquityUsd ?? state.initialEquityUsd);
    engine.dayKey = state.dayKey ?? null;
    engine.dayStartEquityUsd = Number(state.dayStartEquityUsd ?? state.initialEquityUsd);
    engine.dailyLossHalted = Boolean(state.dailyLossHalted);
    return engine;
  }
}
