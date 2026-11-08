import { config } from './core/config.js';
import { ChainRegistry } from './adapters/chain-registry.js';
import { buildReadOnlyAdapters } from './adapters/configured-adapters.js';
import { createGmgnReadOnlyProvider } from './adapters/gmgn-readonly.js';
import { createHeliusReadOnlyAdapter } from './adapters/helius-readonly.js';
import { createAiProvider } from './ai/provider.js';
import { PaperLedger } from './core/paper-ledger.js';
import { scorePool } from './core/pool-score.js';
import { planRange } from './core/range-planner.js';
import { estimateFeeYield } from './core/fee-model.js';
import { buildBinDistribution } from './core/bin-distribution.js';

export const registry = new ChainRegistry();
export const ledger = new PaperLedger(0);
export const readOnly = buildReadOnlyAdapters();
export const gmgn = createGmgnReadOnlyProvider();
export const helius = process.env.HELIUS_API_KEY || process.env.HELIUS_RPC_URL
  ? createHeliusReadOnlyAdapter() : null;
export const aiProvider = createAiProvider();
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
    mode:config.mode, paperOnly:true, startingEquitySol:config.startingEquitySol,
    configuredAdapters:registry.chains(),
    robinhoodRpcDefaultAvailable:true,
    gmgnConfigured:gmgn.enabled,
    heliusConfigured:Boolean(helius),
    aiProviderPrimary:aiProvider.primary,
    aiProvidersAvailable:aiProvider.available,
    meteoraOnchainAvailable:true,
    message:'No signing, swap, add-liquidity, remove-liquidity or transaction submission code exists.'
  },null,2));
}
