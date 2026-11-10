import { PaperTradingEngine, METEORA_DLMM_PROGRAM_ID } from '../src/core/paper-engine.js';

const DAY = 86_400_000;
const MINUTE = 60_000;
const BASE_TIME = Date.UTC(2026, 0, 1);
const INITIAL_EQUITY_USD = 10_000;
const TRADE_COUNT = 20;

function makeCandles(now, intervalMs, count = 80) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.025 + Math.sin(index * 0.9 + 1.4) * 0.15;
    return {
      timestamp: now - (count - index) * intervalMs - 30_000,
      open: close - 0.02,
      high: close + 0.35,
      low: close - 0.35,
      close,
      volume: index === count - 1 ? 1_200 : 1_000
    };
  });
}

function buildSnapshot(index, now) {
  const poolAddress = 'synthetic-pool-' + index;
  const tokenMint = 'synthetic-mint-' + index;
  const candles5m = makeCandles(now, 5 * MINUTE);
  const candles30m = makeCandles(now, 30 * MINUTE);
  const verifiedEvent = (wallet, offset, instructionIndex) => ({
    walletAddress: wallet,
    eventType: 'add-liquidity',
    verified: true,
    success: true,
    programId: METEORA_DLMM_PROGRAM_ID,
    poolAddress,
    signature: 'synthetic-signature-' + index + '-' + wallet,
    instructionIndex,
    quoteSide: true,
    quoteAmountUsd: 150,
    walletRankVerified: true,
    walletRankSource: 'top-lp-wallet-index',
    walletRankScore: 82,
    timestamp: now - offset
  });

  return {
    timestamp: now,
    pool: {
      poolAddress,
      tokenMint,
      chain: 'solana',
      symbol: 'SYN/SOL',
      tvlUsd: 100_000,
      activeTvlUsd: 75_000,
      volume24hUsd: 150_000,
      fees24hUsd: 150,
      fees7dUsd: 1_000,
      binStep: 100,
      feeActiveTvlRatio: 0.20,
      quoteOrganicScore: 82,
      dataAgeSec: 5,
      volatility24hPct: 3.5,
      liquidityTrend24hPct: 0
    },
    pairEvidence: {
      source: 'dexscreener',
      chainId: 'solana',
      pairAddress: poolAddress,
      baseToken: { address: tokenMint },
      quoteToken: { address: 'So11111111111111111111111111111111111111112' },
      pairCreatedAtMs: now - 21 * DAY,
      marketCapUsd: 2_000_000,
      fdvUsd: 2_400_000,
      liquidityUsd: 400_000,
      priceChange24hPct: 12,
      txns24h: { buys: 100, sells: 60 },
      dataRetrievedAt: now
    },
    security: {
      verified: true,
      mintAuthorityDisabled: true,
      freezeAuthorityDisabled: true,
      honeypot: false,
      scam: false,
      dataAgeSec: 10,
      top10HoldersPct: 25,
      top10DevWalletPct: 5,
      holders: 1_000,
      tokenAgeDays: 30,
      marketCapUsd: 2_000_000,
      organicScore: 82,
      botHoldersPct: 8,
      tokenFeesSol: 55,
      devBlocked: false,
      launchpad: 'pool_meteora'
    },
    marketData: { candles5mAgeSec: 30, candles30mAgeSec: 30 },
    candles5m,
    candles30m,
    priceUsd: candles5m.at(-1).close,
    walletSignals: [
      verifiedEvent('wallet-a-' + index, 20_000, 1),
      verifiedEvent('wallet-b-' + index, 10_000, 2)
    ],
    walletActivity: {
      verified: true,
      source: 'helius-wallet-monitor',
      generatedAt: now,
      dataAgeSec: 0,
      windowHours: 24,
      uniqueActiveWallets24h: 2,
      addEvents: 2,
      removeEvents: 0,
      quoteAddsUsd: 300,
      quoteRemovesUsd: 0,
      netQuoteFlowUsd: 300,
      averageWalletRankScore: 82,
      walletActivityScore: 82
    },
    lpMark: {
      verified: true,
      source: 'meteora-position-v2-bin-fee-replay',
      feesSinceLastUsd: 0,
      positionFeeApr24hPct: 170,
      positionFeeApr7dPct: 160,
      inRange: true
    },
    lpRisk: {
      verified: true,
      source: 'meteora-bin-stress-simulator',
      feeModelVerified: true,
      feeModelSource: 'meteora-position-v2-bin-fee-replay',
      positionFeeApr24hPct: 170,
      positionFeeApr7dPct: 160,
      stressLossPct: 5,
      expectedInventoryDragPct7d: 0.05,
      simulatedRangeCoveragePct: 98
    }
  };
}

function interleavedOutcomes(tradeCount, winsCount) {
  return Array.from({ length: tradeCount }, (_, index) =>
    Math.floor(((index + 1) * winsCount) / tradeCount) >
    Math.floor((index * winsCount) / tradeCount)
  );
}

async function runScenario({ name, winRateTargetPct }) {
  const winsPlanned = Math.round(TRADE_COUNT * winRateTargetPct / 100);
  const outcomes = interleavedOutcomes(TRADE_COUNT, winsPlanned);
  const engine = new PaperTradingEngine({ initialEquityUsd: INITIAL_EQUITY_USD });
  let peakEquity = INITIAL_EQUITY_USD;
  let maxDrawdownPct = 0;
  let openedTrades = 0;
  let blockedEntries = 0;

  const updateDrawdown = result => {
    const equity = result.portfolio.equityUsd;
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peakEquity - equity) / peakEquity * 100);
  };

  for (let index = 0; index < TRADE_COUNT; index++) {
    const now = BASE_TIME + index * DAY;
    const entrySnapshot = buildSnapshot(index, now);
    const entryResult = await engine.processSnapshot(entrySnapshot);
    updateDrawdown(entryResult);

    if (entryResult.entry.status !== 'opened') {
      blockedEntries++;
      continue;
    }
    openedTrades++;

    if (outcomes[index]) {
      const peak = buildSnapshot(index, now + MINUTE);
      peak.walletSignals = [];
      peak.inventoryPnlPct = 6.5;
      updateDrawdown(await engine.processSnapshot(peak));

      const trail = buildSnapshot(index, now + 2 * MINUTE);
      trail.walletSignals = [];
      trail.inventoryPnlPct = 4.5;
      const closeResult = await engine.processSnapshot(trail);
      updateDrawdown(closeResult);
    } else {
      const stop = buildSnapshot(index, now + MINUTE);
      stop.walletSignals = [];
      stop.inventoryPnlPct = -5.2;
      stop.priceUsd = stop.priceUsd * 0.49;
      const closeResult = await engine.processSnapshot(stop);
      updateDrawdown(closeResult);
    }
  }

  const summary = engine.summary();
  const trades = engine.closedTrades;
  const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const wins = trades.filter(trade => trade.netPnlUsd > 0);
  const losses = trades.filter(trade => trade.netPnlUsd < 0);
  return {
    scenario: name,
    targetWinRatePct: winRateTargetPct,
    tradesOpened: openedTrades,
    tradesClosed: trades.length,
    blockedEntries,
    winRatePct: trades.length ? wins.length / trades.length * 100 : null,
    netProfitUsd: summary.equityUsd - INITIAL_EQUITY_USD,
    returnPct: (summary.equityUsd / INITIAL_EQUITY_USD - 1) * 100,
    maxDrawdownPct,
    profitFactor: summary.profitFactor,
    averageWinUsd: average(wins.map(trade => trade.netPnlUsd)),
    averageLossUsd: average(losses.map(trade => trade.netPnlUsd)),
    endingEquityUsd: summary.equityUsd,
    allPositionsClosed: summary.openPositions === 0,
    dataLabel: 'synthetic deterministic scenario; NOT historical market replay'
  };
}

const scenarios = [
  { name: 'Bear case', winRateTargetPct: 40 },
  { name: 'Balanced case', winRateTargetPct: 50 },
  { name: 'Base case', winRateTargetPct: 60 },
  { name: 'Strong case', winRateTargetPct: 70 }
];

const results = [];
for (const scenario of scenarios) results.push(await runScenario(scenario));

const report = {
  title: 'Wave_Agent balanced LP synthetic dry-run',
  generatedAt: new Date().toISOString(),
  strategy: { entry: 'hybrid', style: 'balanced-lp', exit: 'dynamic-lp' },
  assumptions: {
    initialEquityUsd: INITIAL_EQUITY_USD,
    tradesPerScenario: TRADE_COUNT,
    winnerExit: 'peak +6.5%, then retrace to +4.5% to trigger profit trailing lock',
    loserExit: '50% spot drawdown from entry to trigger the asymmetric hard stop',
    rebalancePolicy: 'paper range rebalance proposals at -15%, -30% and -45%; fresh read-only router quote and existing inventory only',
    allCandidates: 'synthetic pair age 21d, market cap $2m, FDV $2.4m, pair liquidity $400k, 24h fees $150, 7d fees $1,000',
    risk: '0.3% equity risk per position, 0.6% aggregate risk, max 90% portfolio capital utilization and 10% cash reserve',
    exclusions: 'No real wallet history, no real Meteora bin replay, no real fill/slippage or observed LP fee checkpoints'
  },
  results
};

console.log('SYNTHETIC DRY RUN ONLY — NOT HISTORICAL PERFORMANCE');
console.log(JSON.stringify(report, null, 2));
if (results.some(result => !result.allPositionsClosed || result.blockedEntries > 0 || result.tradesClosed !== TRADE_COUNT)) {
  process.exitCode = 1;
}
