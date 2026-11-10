import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './core/config.js';
import { PaperTradingEngine } from './core/paper-engine.js';
import { createPaperOrchestrator } from './runtime/paper-orchestrator.js';

if (!(config.startingEquityUsd > 0)) {
  console.error('Set PAPER_STARTING_EQUITY_USD or SOL_PRICE_USD before starting paper runtime.');
  process.exit(2);
}
const providerPath = process.env.PAPER_SNAPSHOT_PROVIDER_MODULE;
if (!providerPath) {
  console.error('Set PAPER_SNAPSHOT_PROVIDER_MODULE to a local read-only snapshot provider. Runtime will not invent market data.');
  process.exit(2);
}

const providerUrl = pathToFileURL(path.resolve(providerPath)).href;
const providerModule = await import(providerUrl);
if (typeof providerModule.createSnapshotProvider !== 'function') {
  throw new Error('Snapshot provider module must export createSnapshotProvider({ config, env })');
}
const snapshotProvider = await providerModule.createSnapshotProvider({ config, env: process.env });
if (snapshotProvider?.readOnly !== true || typeof snapshotProvider.getSnapshots !== 'function') {
  throw new Error('Snapshot provider must be explicitly read-only and implement getSnapshots()');
}

const ai = { available: [] };
const engineConfig = {
  strategy: config.strategy,
  riskPerPositionPct: config.maxRiskPerPositionPct,
  maxPortfolioRiskPct: config.maxPortfolioRiskPct,
  maxPositionAllocationPct: config.maxPositionAllocationPct,
  maxPortfolioUtilizationPct: config.maxPortfolioUtilizationPct,
  hardStopLossPct: config.hardStopLossPct,
  rebalanceLevelsPct: config.rebalanceLevelsPct,
  rebalanceQuoteMaxAgeSec: config.rebalanceQuoteMaxAgeSec,
  requireRankedWallets: config.requireRankedWallets,
  requireWalletActivity: config.requireWalletActivity,
  minWalletRankScore: config.minWalletRankScore,
  maxOpenPositions: config.maxOpenPositions,
  minTvlUsd: config.minTvlUsd,
  maxTvlUsd: config.maxTvlUsd,
  minVolume24hUsd: config.minVolume24hUsd,
  maxPoolDataAgeSec: config.maxPoolDataAgeSec,
  maxSecurityDataAgeSec: config.maxSecurityDataAgeSec,
  minPairAgeDays: config.minPairAgeDays,
  maxPairEvidenceAgeSec: config.maxPairEvidenceAgeSec,
  minMarketCapUsd: config.minMarketCapUsd,
  maxMarketCapUsd: config.maxMarketCapUsd,
  maxFdvToMarketCap: config.maxFdvToMarketCap,
  minPairLiquidityUsd: config.minPairLiquidityUsd,
  minLiquidityToMarketCap: config.minLiquidityToMarketCap,
  minTransactions24h: config.minTransactions24h,
  minSells24h: config.minSells24h,
  minSellBuyRatio: config.minSellBuyRatio,
  maxSellBuyRatio: config.maxSellBuyRatio,
  minPairPriceChange24hPct: config.minPairPriceChange24hPct,
  maxPairPriceChange24hPct: config.maxPairPriceChange24hPct,
  minOrganicScore: config.minOrganicScore,
  minQuoteOrganicScore: config.minQuoteOrganicScore,
  maxBotHoldersPct: config.maxBotHoldersPct,
  minTokenFeesSol: config.minTokenFeesSol,
  minBinStep: config.minBinStep,
  maxBinStep: config.maxBinStep,
  minFeeActiveTvlRatio: config.minFeeActiveTvlRatio,
  maxVolatility24hPct: config.maxVolatility24hPct,
  allowedLaunchpads: config.allowedLaunchpads,
  blockedLaunchpads: config.blockedLaunchpads,
  minPoolFeeApr7dPct: config.minPoolFeeApr7dPct,
  minPoolFeeApr24hPct: config.minPoolFeeApr24hPct,
  minPositionFeeApr7dPct: config.minPositionFeeApr7dPct,
  minPositionFeeApr24hPct: config.minPositionFeeApr24hPct,
  minExpectedNetEdgePct: config.minExpectedNetEdgePct,
  minFeeCoverageRatio: config.minFeeCoverageRatio,
  maxInventoryDragPct7d: config.maxInventoryDragPct7d,
  feeCaptureShare: config.feeCaptureShare,
  expectedHoldHours: config.expectedHoldHours,
  roundTripCostBps: config.roundTripCostBps,
  maxStressLossPct: config.maxStressLossPct,
  maxDailyLossPct: config.maxDailyLossPct,
  maxDrawdownPct: config.maxDrawdownPct
};

const statePath = process.env.PAPER_STATE_PATH || './data/paper-state-lp.json';
let engine;
try {
  const saved = JSON.parse(await fs.readFile(statePath, 'utf8'));
  engine = PaperTradingEngine.fromState(saved, { config: engineConfig });
  process.stderr.write('Restored paper engine state from ' + statePath + '\n');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  engine = new PaperTradingEngine({ initialEquityUsd: config.startingEquityUsd, config: engineConfig });
  process.stderr.write('Started new paper account at $' + config.startingEquityUsd.toFixed(2) + '\n');
}

const intervalMs = Math.max(5_000, Number(process.env.PAPER_RUNTIME_INTERVAL_MS ?? 60_000));
const runtime = createPaperOrchestrator({
  engine,
  snapshotProvider,
  statePath,
  intervalMs,
  onResult: result => process.stdout.write(JSON.stringify({ type: 'paper_cycle_result', result }) + '\n'),
  onError: error => process.stderr.write(JSON.stringify({ type: 'paper_cycle_error', message: error.message }) + '\n')
});

await runtime.start();
process.stderr.write(JSON.stringify({ type: 'paper_runtime_started', intervalMs, statePath, paperOnly: true }) + '\n');
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  const result = await runtime.stop();
  process.stderr.write(JSON.stringify({ type: 'paper_runtime_stopped', signal, result }) + '\n');
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
