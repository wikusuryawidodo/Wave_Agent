import { createMeteoraDataAdapter } from './meteora-api.js';
import { createV3SubgraphAdapter } from './subgraph-clmm.js';
import { createRobinhoodRpc } from './robinhood-chain.js';
import { createMeteoraOnchainAdapter } from './meteora-onchain.js';
export function buildReadOnlyAdapters({ fetchImpl=fetch, env=process.env } = {}) {
  const adapters=[];
  adapters.push(createMeteoraDataAdapter({fetchImpl}));
  if (env.BASE_UNISWAP_SUBGRAPH_URL) adapters.push(createV3SubgraphAdapter({
    chain:'base', endpoint:env.BASE_UNISWAP_SUBGRAPH_URL, fetchImpl, protocol:'uniswap-v3-base'
  }));
  if (env.BSC_PANCAKE_SUBGRAPH_URL) adapters.push(createV3SubgraphAdapter({
    chain:'bsc', endpoint:env.BSC_PANCAKE_SUBGRAPH_URL, fetchImpl, protocol:'pancakeswap-v3-bsc'
  }));
  if (env.ROBINHOOD_UNISWAP_SUBGRAPH_URL) adapters.push(createV3SubgraphAdapter({
    chain:'robinhood', endpoint:env.ROBINHOOD_UNISWAP_SUBGRAPH_URL, fetchImpl, protocol:'uniswap-v3-robinhood'
  }));
  return { adapters, meteoraOnchain:createMeteoraOnchainAdapter({rpcUrl:env.HELIUS_RPC_URL || env.SOLANA_RPC_URL,fetchImpl}), robinhoodRpc:createRobinhoodRpc({fetchImpl}) };
}
