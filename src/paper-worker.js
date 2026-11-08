import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { config } from './core/config.js';
import { createAiProvider } from './ai/provider.js';
import { createMarketAnalyst } from './ai/analyst.js';
import { PaperTradingEngine } from './core/paper-engine.js';

if (!(config.startingEquityUsd > 0)) {
  console.error('Set SOL_PRICE_USD or PAPER_STARTING_EQUITY_USD before starting the paper worker.');
  process.exit(2);
}

const statePath = process.env.PAPER_STATE_PATH || './data/paper-state.json';
const ai = createAiProvider();
const analyst = ai.available.length ? createMarketAnalyst(ai) : null;
const engineConfig = {
  riskPerPositionPct: config.maxRiskPerPositionPct,
  maxPortfolioRiskPct: config.maxPortfolioRiskPct,
  maxPositionAllocationPct: config.maxPositionAllocationPct,
  maxOpenPositions: config.maxOpenPositions,
  minTvlUsd: config.minTvlUsd,
  minVolume24hUsd: config.minVolume24hUsd,
  maxVolumeToTvl: config.maxVolumeToTvl,
  maxPoolDataAgeSec: config.maxPoolDataAgeSec,
  maxDailyLossPct: config.maxDailyLossPct,
  maxDrawdownPct: config.maxDrawdownPct
};
let engine;
try {
  const saved = JSON.parse(await fs.readFile(statePath, 'utf8'));
  engine = PaperTradingEngine.fromState(saved, { analyst, config: engineConfig });
  process.stderr.write(\`Restored paper state: \${statePath}\n\`);
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(\`Cannot restore paper state: \${error.message}\`);
    process.exit(2);
  }
  engine = new PaperTradingEngine({ initialEquityUsd: config.startingEquityUsd, analyst, config: engineConfig });
  process.stderr.write(\`Created paper account with $\${config.startingEquityUsd.toFixed(2)} starting equity.\n\`);
}

async function persist() {
  await fs.mkdir(path.dirname(path.resolve(statePath)), { recursive: true });
  const temporary = \`\${statePath}.tmp\`;
  await fs.writeFile(temporary, JSON.stringify(engine.exportState(), null, 2), { mode: 0o600 });
  await fs.rename(temporary, statePath);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const snapshot = JSON.parse(line);
    const result = await engine.processSnapshot(snapshot);
    await persist();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ type: 'paper_input_error', message: error.message }) + '\n');
  }
}
