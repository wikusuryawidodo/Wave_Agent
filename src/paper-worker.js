import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { config } from './core/config.js';
import { createAiProvider } from './ai/provider.js';
import { createMarketAnalyst } from './ai/analyst.js';
import { PaperTradingEngine } from './core/paper-engine.js';

if (!(config.startingEquityUsd > 0)) {
  console.error('Set SOL_PRICE_USD or PAPER_STARTING_EQUITY_USD before starting the LP paper worker.');
  process.exit(2);
}

const statePath = process.env.PAPER_STATE_PATH || './data/paper-state-lp.json';
const ai = createAiProvider();
const analyst = ai.available.length ? createMarketAnalyst(ai) : null;
const engineConfig = {
  strategy: config.strategy,
  riskPerPositionPct: config.maxRiskPerPositionPct,
  maxPortfolioRiskPct: config.maxPortfolioRiskPct,
  maxPositionAllocationPct: config.maxPositionAllocationPct,
  maxOpenPositions: config.maxOpenPositions,
  minTvlUsd: config.minTvlUsd,
  minVolume24hUsd: config.minVolume24hUsd,
  maxPoolDataAgeSec: config.maxPoolDataAgeSec,
  maxSecurityDataAgeSec: config.maxSecurityDataAgeSec,
  minPairAgeDays: config.minPairAgeDays,
  maxPairEvidenceAgeSec: config.maxPairEvidenceAgeSec,
  minMarketCapUsd: config.minMarketCapUsd,
  maxFdvToMarketCap: config.maxFdvToMarketCap,
  minPairLiquidityUsd: config.minPairLiquidityUsd,
  minLiquidityToMarketCap: config.minLiquidityToMarketCap,
  minTransactions24h: config.minTransactions24h,
  minSells24h: config.minSells24h,
  minSellBuyRatio: config.minSellBuyRatio,
  maxSellBuyRatio: config.maxSellBuyRatio,
  minPairPriceChange24hPct: config.minPairPriceChange24hPct,
  maxPairPriceChange24hPct: config.maxPairPriceChange24hPct,
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
  maxVolatility24hPct: config.maxVolatility24hPct,
  maxStressLossPct: config.maxStressLossPct,
  maxDailyLossPct: config.maxDailyLossPct,
  maxDrawdownPct: config.maxDrawdownPct
};

let engine;
try {
  const saved = JSON.parse(await fs.readFile(statePath, 'utf8'));
  engine = PaperTradingEngine.fromState(saved, { analyst, config: engineConfig });
  process.stderr.write('Restored LP paper state: ' + statePath + '\n');
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error('Cannot restore LP paper state: ' + error.message);
    process.exit(2);
  }
  engine = new PaperTradingEngine({
    initialEquityUsd: config.startingEquityUsd,
    analyst,
    config: engineConfig
  });
  process.stderr.write('Created LP paper account with $' + config.startingEquityUsd.toFixed(2) + ' starting equity.\n');
}

async function persist() {
  await fs.mkdir(path.dirname(path.resolve(statePath)), { recursive: true });
  const temporary = statePath + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(engine.exportState(), null, 2), { mode: 0o600 });
  await fs.rename(temporary, statePath);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const result = await engine.processSnapshot(JSON.parse(line));
    await persist();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ type: 'paper_input_error', message: error.message }) + '\n');
  }
}
