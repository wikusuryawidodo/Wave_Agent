import { config } from './core/config.js';
import { ChainRegistry } from './adapters/chain-registry.js';
import { buildReadOnlyAdapters } from './adapters/configured-adapters.js';
import { createGmgnReadOnlyProvider } from './adapters/gmgn-readonly.js';
import { createGmgnCliReadOnlyProvider } from './adapters/gmgn-cli-readonly.js';
import { createHeliusReadOnlyAdapter } from './adapters/helius-readonly.js';
import { createAiProvider } from './ai/provider.js';
import { createDexScreenerReadOnlyAdapter } from './adapters/dexscreener-readonly.js';
import { PaperLedger } from './core/paper-ledger.js';
import { estimateFeeYield } from './core/fee-model.js';

export { PaperTradingEngine } from './core/paper-engine.js';
export { rankGmgnDiscoveryTokens } from './core/gmgn-discovery.js';
export { rankTopLpWallets, enrichWalletEvent, summarizeWalletActivity } from './core/wallet-intelligence.js';
export { summarizeHaloPerformance, summarizeHaloPoolHistory, chooseHaloPositionShape, calculateHaloSizing } from './core/halo-lp-profile.js';
export { evaluateAsymmetricRebalance, ASYMMETRIC_REBALANCE_LEVELS_PCT } from './core/asymmetric-rebalance.js';
export { createMeteoraWalletActivityAdapter, decodeMeteoraLiquidityEvents } from './adapters/meteora-wallet-activity.js';
export { createMeteoraPnLReadOnlyAdapter } from './adapters/meteora-pnl-readonly.js';
export { createJupiterTokenScreeningAdapter } from './adapters/jupiter-token-screening.js';
export { createTopLpWalletIndexAdapter } from './adapters/top-lp-wallet-index.js';
export { createPaperDataBridge } from './adapters/paper-data-bridge.js';
export { createPaperOrchestrator } from './runtime/paper-orchestrator.js';

export {
  rankTrendingPools,
  chooseTrendingZapRange,
  chooseDirectionalSingleSidedRange,
  evaluateTrendingZapCandidate,
  evaluateZapPositionMark
} from './core/trending-zap-strategy.js';

export const registry = new ChainRegistry();
export const ledger = new PaperLedger(config.startingEquityUsd);
export const readOnly = buildReadOnlyAdapters();
export const gmgn = createGmgnReadOnlyProvider();
export const gmgnCli = createGmgnCliReadOnlyProvider();
export const helius = process.env.HELIUS_API_KEY || process.env.HELIUS_RPC_URL
  ? createHeliusReadOnlyAdapter() : null;
export const aiProvider = createAiProvider();
export const dexScreener = createDexScreenerReadOnlyAdapter();
export const meteoraOnchain = readOnly.meteoraOnchain;
for (const adapter of readOnly.adapters) registry.register(adapter);

export async function scanMeteora({ page=1, pageSize=100 } = {}) {
  const adapter=registry.get('solana');
  const pools=await adapter.getPools({page,pageSize});
  return pools.map(pool=>({
    pool,
    feeModel: pool.tvlUsd>0 && pool.fees24hUsd>=0
      ? estimateFeeYield({tvlUsd:pool.tvlUsd,fees24hUsd:pool.fees24hUsd,allocationUsd:1000})
      : null,
    note:'Candle retrieval and indicator scoring are a separate step; do not infer entry from TVL/fees alone.'
  }));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  console.log('Meridian DLMM Multi-chain — READ-ONLY + PAPER');
  console.log(JSON.stringify({
    mode:config.mode,
    strategy:config.strategy,
    paperOnly:true,
    startingEquitySol:config.startingEquitySol,
    startingEquityUsd:config.startingEquityUsd || null,
    riskPerPositionPct:config.maxRiskPerPositionPct*100,
    maxPortfolioRiskPct:config.maxPortfolioRiskPct*100,
    configuredAdapters:registry.chains(),
    robinhoodRpcDefaultAvailable:true,
    gmgnSkillsBridgeConfigured:gmgn.enabled,
    gmgnCliReadOnlyAdapterAvailable:true,
    heliusConfigured:Boolean(helius),
    aiProviderPrimary:aiProvider.primary,
    aiProvidersAvailable:aiProvider.available,
    meteoraOnchainAvailable:true,
    message:'No signing, swap, add-liquidity, remove-liquidity or transaction submission code exists.'
  },null,2));
}
